import {connect, ConnectOptions} from 'mongoose'
require('dotenv').config();

export const ConnectDB = async() => {
    try {
        const conn = await connect(process.env.MONGO_URL || "", {
        } as ConnectOptions);

        console.log(`MongoDB Connected: ${conn.connection.host}!`);
    } catch (err) {
        console.log(`MongoDB Connection Failed: ${err}`);
        process.exit();
    }
};