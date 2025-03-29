import { Schema, Types, model } from "mongoose";

const userSchema = new Schema({
    id: {
        type: String,
        required: true,
    },
    cfUsername: {
        type: String,
        required: true,
    },
    guildId: {
        type: String,
        required: true,
    },
}, {
    timestamps: true,
});

export const User = model("User", userSchema);