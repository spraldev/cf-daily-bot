import { REST, Routes } from 'discord.js';
import 'dotenv/config';

const token = process.env.DISCORD_BOT_TOKEN;
const applicationId = "1355041181796401264"; // Replace with your bot's application ID if needed

if (!token) {
  console.error("Error: DISCORD_BOT_TOKEN environment variable is not set.");
  process.exit(1);
}

const commands = [
  {
    name: 'ping',
    description: 'Replies with Pong & shows latency!',
  },
  {
    name: 'login',
    description: 'Connect your Codeforces account to the bot!',
    options: [
      {
        name: 'handle',
        type: 3, // string
        description: 'Your Codeforces handle',
        required: true,
      },
    ],
  },
  {
    name: 'check',
    description: 'Check if you solved the daily problem!',
  },
  {
    name: 'setdailyproblem',
    description: 'Set the daily Codeforces problem (Admin only).',
    options: [
      {
        name: 'problem_url',
        type: 3,
        description: 'The Codeforces problem URL (e.g., https://codeforces.com/contest/123/problem/A)',
        required: true,
      },
    ],
  },
  {
    name: 'setleaderboardchannel',
    description: 'Set the channel for the leaderboard (Admin only).',
    options: [
      {
        name: 'channel',
        type: 7, // channel type
        description: 'A text channel for the leaderboard',
        required: true,
      },
    ],
  },
  {
    name: 'setannouncementchannel',
    description: 'Set the channel for announcements (Admin only).',
    options: [
      {
        name: 'channel',
        type: 7, // channel type
        description: 'A text channel for announcements',
        required: true,
      },
    ],
  },
  {
    name: 'botinfo',
    description: 'Get information about the bot, including uptime and stats.',
  },
  {
    name: 'help',
    description: 'Show help information for the bot!',
  },
  {
    name: 'leaderboard',
    description: 'Display the current leaderboard publicly.',
  },
];

const rest = new REST({ version: '10' }).setToken(token);

async function deployCommands() {
  try {
    console.log('Started refreshing application (/) commands.');
    const data = await rest.put(
      Routes.applicationCommands(applicationId),
      { body: commands }
    );
    console.log(`Successfully reloaded application (/) commands. Total commands: ${Array.isArray(data) ? data.length : 0}`);
  } catch (error: any) {
    console.error('Error deploying commands:');
    if (error.code) {
      console.error(`Error Code: ${error.code}`);
    }
    if (error.response?.data) {
      console.error('Response Data:', error.response.data);
    } else {
      console.error(error);
    }
    process.exit(1);
  }
}

deployCommands();
