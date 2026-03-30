var express = require('express');
var router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
let modelMessage = require('../schemas/messages');
let modelUser = require('../schemas/users');
let { checkLogin } = require('../utils/authHandler.js.js');

// Configure multer for file upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = 'uploads/messages/';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '_' + file.originalname);
  }
});

const upload = multer({ storage: storage });

/* 1. GET /api/v1/messages/:userID - Lấy tất cả tin nhắn giữa 2 user */
router.get('/:userID', checkLogin, async function (req, res, next) {
  try {
    let currentUserId = req.userId; // User hiện tại (từ token)
    let targetUserId = req.params.userID; // User khác (từ URL)

    console.log(`📨 Getting messages between ${currentUserId} and ${targetUserId}`);

    // Tìm tất cả tin nhắn giữa 2 user
    let messages = await modelMessage.find({
      $or: [
        { from: currentUserId, to: targetUserId },
        { from: targetUserId, to: currentUserId }
      ],
      isDeleted: false
    })
    .populate('from', 'username email')
    .populate('to', 'username email')
    .sort({ createdAt: 1 });

    res.json({
      success: true,
      count: messages.length,
      data: messages
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    res.status(500).json({
      success: false,
      message: "Error fetching messages",
      error: error.message
    });
  }
});

/* 2. POST /api/v1/messages - Gửi tin nhắn (text hoặc file) */
router.post('/', checkLogin, upload.single('file'), async function (req, res, next) {
  try {
    let from = req.userId; // User gửi (từ token)
    let { to, type, text } = req.body;

    console.log('📨 Sending message:');
    console.log('from:', from);
    console.log('to:', to);
    console.log('type:', type);

    // Kiểm tra required fields
    if (!to || !type) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: to, type"
      });
    }

    // Kiểm tra user nhận có tồn tại không
    const toUser = await modelUser.findById(to);
    if (!toUser) {
      return res.status(404).json({
        success: false,
        message: "User nhận không tồn tại"
      });
    }

    let messageContent = { type };

    // Nếu gửi text
    if (type === 'text') {
      if (!text) {
        return res.status(400).json({
          success: false,
          message: "Text content is required"
        });
      }
      messageContent.text = text;
    } 
    // Nếu gửi file
    else if (type === 'file') {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "File is required"
        });
      }
      messageContent.filePath = req.file.path;
    } 
    else {
      return res.status(400).json({
        success: false,
        message: "Type phải là 'text' hoặc 'file'"
      });
    }

    // Tạo tin nhắn mới
    let newMessage = new modelMessage({
      from: from,
      to: to,
      messageContent: messageContent
    });

    await newMessage.save();
    await newMessage.populate('from', 'username email');
    await newMessage.populate('to', 'username email');

    console.log('✅ Message sent successfully');

    res.json({
      success: true,
      message: "Gửi tin nhắn thành công",
      data: newMessage
    });

  } catch (error) {
    // Xóa file nếu có lỗi
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    console.error('❌ Error:', error.message);
    res.status(500).json({
      success: false,
      message: "Error sending message",
      error: error.message
    });
  }
});

/* 3. GET /api/v1/messages - Lấy danh sách conversations (tin nhắn cuối cùng với mỗi user) */
router.get('/', checkLogin, async function (req, res, next) {
  try {
    let currentUserId = req.userId; // User hiện tại (từ token)

    console.log(`📨 Getting conversations for user ${currentUserId}`);

    // Tìm tất cả tin nhắn của user hiện tại
    let allMessages = await modelMessage.find({
      $or: [
        { from: currentUserId },
        { to: currentUserId }
      ],
      isDeleted: false
    })
    .populate('from', 'username email')
    .populate('to', 'username email')
    .sort({ createdAt: -1 });

    // Nhóm tin nhắn theo user khác
    let conversations = {};

    for (let msg of allMessages) {
      // Xác định user khác
      let otherUserId = msg.from._id.toString() === currentUserId ? msg.to._id : msg.from._id;
      let otherUser = msg.from._id.toString() === currentUserId ? msg.to : msg.from;

      // Nếu chưa có conversation với user này, thêm vào
      if (!conversations[otherUserId]) {
        conversations[otherUserId] = {
          otherUser: {
            _id: otherUser._id,
            username: otherUser.username,
            email: otherUser.email
          },
          lastMessage: msg
        };
      }
    }

    // Convert object thành array
    let conversationList = Object.values(conversations);

    res.json({
      success: true,
      count: conversationList.length,
      data: conversationList
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    res.status(500).json({
      success: false,
      message: "Error fetching conversations",
      error: error.message
    });
  }
});

module.exports = router;