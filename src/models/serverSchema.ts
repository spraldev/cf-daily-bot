import { Schema, Types, model } from "mongoose";

const serverSchema = new Schema({
    daily: {
        type: String,
    },
    members: [{
        user: {
            type: Types.ObjectId,
            ref: "User"
        },
        points: {
            type: Number,
            default: 0
        },
        lastSubmitted: {
            type: String,
            default: null
        },
    }],
    guildId: {
        type: String,
        required: true,
    },
    channelId: {
        type: String,

    },
    announcementChannelId: {
        type: String,

    },

    messageId: {
        type: String,
    },
}, {
    timestamps: true,
});

export const Server = model("Server", serverSchema);