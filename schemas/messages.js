let mongoose = require('mongoose');

let messageSchema = mongoose.Schema({
    from: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "user",
        required: true
    },
    to: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "user",
        required: true
    },
    messageContent: {
        type: {
            type: String,
            enum: ['file', 'text'],
            required: true
        },
        text: {
            type: String,
            required: function() {
                return this.messageContent.type === 'text';
            }
        },
        filePath: {
            type: String,
            required: function() {
                return this.messageContent.type === 'file';
            }
        }
    },
    isDeleted: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('message', messageSchema);