var express = require('express');
var router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
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

/* GET messages by userID - lấy toàn bộ message from: user hiện tại, to: userID và from: userID và to: user hiện tại */
router.get('/:userID', checkLogin, async function (req, res, next) {
  try {
    let currentUserId = req.userId; // Lấy từ token (đã login)
    let targetUserId = req.params.userID; // User khác

    console.log(`📨 Getting messages between ${currentUserId} and ${targetUserId}`);

    // Lấy tất cả tin nhắn giữa 2 users
    let messages = await modelMessage.find({
      $or: [
        { from: currentUserId, to: targetUserId },
        { from: targetUserId, to: currentUserId }
      ],
      isDeleted: false
    })
    .populate('from', 'username email')
    .populate('to', 'username email')
    .sort({ createdAt: 1 }); // Sắp xếp theo thời gian tăng dần

    res.json({
      success: true,
      count: messages.length,
      data: messages,
      conversation: {
        currentUser: currentUserId,
        targetUser: targetUserId
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching messages",
      error: error.message
    });
  }
});

/* POST send message */
router.post('/', checkLogin, upload.single('file'), async function (req, res, next) {
  try {
    // Lấy from từ token (user đã login)
    let from = req.userId;
    let { to, type, text } = req.body;

    console.log('📨 Received message request:');
    console.log('from (from token):', from);
    console.log('to:', to);
    console.log('type:', type);
    console.log('text:', text);
    console.log('file:', req.file);

    // Validate required fields
    if (!to || !type) {
      console.log('❌ Missing fields');
      return res.status(400).json({
        success: false,
        message: "Missing required fields: to, type",
        received: { from, to, type }
      });
    }

    // Validate users exist
    const fromUser = await modelUser.findById(from);
    const toUser = await modelUser.findById(to);

    if (!fromUser || !toUser) {
      return res.status(404).json({
        success: false,
        message: "From user or To user not found"
      });
    }

    let messageContent = { type };

    if (type === 'text') {
      if (!text) {
        return res.status(400).json({
          success: false,
          message: "Text content is required for text messages"
        });
      }
      messageContent.text = text;
    } 
    else if (type === 'file') {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "File is required for file messages"
        });
      }
      messageContent.filePath = req.file.path;
    } 
    else {
      return res.status(400).json({
        success: false,
        message: "Invalid message type. Must be 'text' or 'file'"
      });
    }

    // Create new message
    let newMessage = new modelMessage({
      from: from,
      to: to,
      messageContent: messageContent
    });

    await newMessage.save();

    // Populate user info for response
    await newMessage.populate('from', 'username email');
    await newMessage.populate('to', 'username email');

    res.json({
      success: true,
      message: "Message sent successfully",
      data: newMessage
    });

  } catch (error) {
    // Clean up uploaded file on error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({
      success: false,
      message: "Error sending message",
      error: error.message
    });
  }
});

/* GET messages of current user - lấy message cuối cùng của mỗi user mà user hiện tại nhận tin hoặc user khác nhận cho user hiện tại */
router.get('/', checkLogin, async function (req, res, next) {
  try {
    let currentUserId = req.userId; // Lấy từ token (đã login)

    console.log(`📨 Getting conversations for user ${currentUserId}`);

    // Aggregate để lấy tin nhắn cuối cùng với mỗi user
    let conversations = await modelMessage.aggregate([
      // Match messages involving current user
      {
        $match: {
          $or: [
            { from: new mongoose.Types.ObjectId(currentUserId) },
            { to: new mongoose.Types.ObjectId(currentUserId) }
          ],
          isDeleted: false
        }
      },
      // Add field to identify the other user
      {
        $addFields: {
          otherUser: {
            $cond: {
              if: { $eq: ["$from", new mongoose.Types.ObjectId(currentUserId)] },
              then: "$to",
              else: "$from"
            }
          }
        }
      },
      // Sort by creation time descending
      { $sort: { createdAt: -1 } },
      // Group by other user and get the latest message
      {
        $group: {
          _id: "$otherUser",
          lastMessage: { $first: "$$ROOT" }
        }
      },
      // Lookup user information
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "userInfo"
        }
      },
      {
        $lookup: {
          from: "users",
          localField: "lastMessage.from",
          foreignField: "_id",
          as: "lastMessage.fromUser"
        }
      },
      {
        $lookup: {
          from: "users",
          localField: "lastMessage.to",
          foreignField: "_id",
          as: "lastMessage.toUser"
        }
      },
      // Project final structure
      {
        $project: {
          otherUser: {
            _id: { $arrayElemAt: ["$userInfo._id", 0] },
            username: { $arrayElemAt: ["$userInfo.username", 0] },
            email: { $arrayElemAt: ["$userInfo.email", 0] }
          },
          lastMessage: {
            _id: "$lastMessage._id",
            messageContent: "$lastMessage.messageContent",
            createdAt: "$lastMessage.createdAt",
            from: {
              _id: { $arrayElemAt: ["$lastMessage.fromUser._id", 0] },
              username: { $arrayElemAt: ["$lastMessage.fromUser.username", 0] }
            },
            to: {
              _id: { $arrayElemAt: ["$lastMessage.toUser._id", 0] },
              username: { $arrayElemAt: ["$lastMessage.toUser.username", 0] }
            }
          }
        }
      },
      // Sort by last message time
      { $sort: { "lastMessage.createdAt": -1 } }
    ]);

    res.json({
      success: true,
      count: conversations.length,
      data: conversations,
      currentUser: currentUserId
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching conversations",
      error: error.message
    });
  }
});

module.exports = router;