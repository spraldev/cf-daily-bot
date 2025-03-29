import {
  Client,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
  EmbedBuilder,
  TextChannel,
  ChatInputCommandInteraction,
  ButtonInteraction,
  ChannelType,
  Interaction,
  version as discordVersion,
} from 'discord.js';
import { ConnectDB } from './database/db';
import axios from 'axios';
import { User } from './models/userSchema';
import { Server } from './models/serverSchema';
import 'dotenv/config';

/**
 * Utility function to format uptime from seconds to a string like "1d, 2h, 3m, 4s"
 */
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  seconds %= 86400;
  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;
  const minutes = Math.floor(seconds / 60);
  seconds = Math.floor(seconds % 60);
  return `${days}d, ${hours}h, ${minutes}m, ${seconds}s`;
}

// Define an interface for embed options
interface EmbedOptions {
  title?: string;
  description: string;
  fields?: { name: string; value: string; inline?: boolean }[];
}

// Updated default embed configuration
const DEFAULT_EMBED_CONFIG = {
  color: 0x00ffff, // cyan
  footer: {
    text: "Made with ❤️ by Spral",
    iconURL: "https://www.spral.dev/logo.png",
  },
};

// Helper: create a reusable embed
function createEmbed(options: EmbedOptions): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setDescription(options.description)
    .setColor(DEFAULT_EMBED_CONFIG.color)
    .setFooter({
      text: DEFAULT_EMBED_CONFIG.footer.text,
      iconURL: DEFAULT_EMBED_CONFIG.footer.iconURL,
    });
  if (options.title) embed.setTitle(options.title);
  if (options.fields) embed.addFields(options.fields);
  return embed;
}

// Helper: log errors with context
function logError(context: string, error: any) {
  console.error(`[${context}]`, error);
}

/**
 * safeReply: Immediately replies if not already replied; otherwise uses followUp.
 * This function sends a response to the interaction.
 */
async function safeReply(
  interaction: ChatInputCommandInteraction,
  embed: EmbedBuilder,
  ephemeral: boolean = true
) {
  try {
    if (!interaction.replied) {
      await interaction.reply({ embeds: [embed], ephemeral });
    } else {
      await interaction.followUp({ embeds: [embed], ephemeral });
    }
  } catch (error: any) {
    if (error.code === 10062) {
      console.warn("safeReply: Interaction expired, cannot send reply.");
      return;
    }
    logError("safeReply", error);
  }
}

/**
 * safeReplyEmbed: Same as safeReply.
 */
async function safeReplyEmbed(
  interaction: ChatInputCommandInteraction,
  embed: EmbedBuilder,
  ephemeral: boolean = true
) {
  await safeReply(interaction, embed, ephemeral);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// Utility: safely fetch a text channel
async function fetchTextChannel(channelId: string): Promise<TextChannel | null> {
  try {
    const channel = await client.channels.fetch(channelId);
    if (channel && 'send' in channel && channel.type === ChannelType.GuildText) {
      console.log(`fetchTextChannel: Found text channel ${channelId}`);
      return channel as TextChannel;
    } else {
      console.error(`fetchTextChannel: Channel ${channelId} is not a text channel or could not be fetched`);
    }
  } catch (error) {
    logError('fetchTextChannel', error);
  }
  return null;
}

// Announce the daily problem in the announcement channel
async function announce(guildId: string): Promise<boolean> {
  try {
    console.log("announce: Looking up server with guildId", guildId);
    const server = await Server.findOne({ guildId }).populate("members.user");
    if (!server) {
      console.error('announce: Server not found');
      return false;
    }
    if (!server.daily) {
      console.error('announce: No daily problem set for the server');
      return false;
    }
    if (server.announcementChannelId) {
      console.log("announce: Found announcementChannelId:", server.announcementChannelId);
      const channel = await fetchTextChannel(server.announcementChannelId);
      if (channel) {
        const embed = createEmbed({
          title: "Daily Problem Announcement",
          description: `New Daily Problem: https://codeforces.com/problemset/problem/${server.daily}`,
        });
        console.log("announce: Sending announcement to channel", server.announcementChannelId);
        await channel.send({ embeds: [embed] });
        console.log("announce: Announcement sent successfully");
      } else {
        console.error('announce: Announcement channel not found or not a text channel');
        return false;
      }
    } else {
      console.warn('announce: No announcementChannelId set for server');
      return false;
    }
    return true;
  } catch (error) {
    logError("announce", error);
    return false;
  }
}

// Update the leaderboard message (similar to the announcements system)
async function updateLeaderboard(guildId: string): Promise<boolean> {
  try {
    console.log("updateLeaderboard: Looking up server with guildId", guildId);
    const server = await Server.findOne({ guildId }).populate("members.user");
    if (!server) {
      console.error('updateLeaderboard: Server not found');
      return false;
    }
    if (!server.members || server.members.length === 0) {
      console.log('updateLeaderboard: No members found in the server');
      return false;
    }
    // Sort members in descending order by points
    server.members.sort((a: any, b: any) => (b.points || 0) - (a.points || 0));
    if (!server.channelId) {
      console.error('updateLeaderboard: Channel ID not set for the server');
      return false;
    }
    console.log("updateLeaderboard: Fetching leaderboard channel with ID", server.channelId);
    const channel = await fetchTextChannel(server.channelId);
    if (!channel) {
      console.error('updateLeaderboard: Channel not found or not a text channel');
      return false;
    }
    let leaderboardText = "**Leaderboard for Daily Problem**\n\n";
    let currentRank = 0;
    let lastPoints = -1;
    for (let i = 0; i < server.members.length; i++) {
      const member = server.members[i];
      if (member.user) {
        if (member.points !== lastPoints) {
          currentRank = i + 1;
          lastPoints = member.points;
        }
        leaderboardText += `${currentRank}. <@${member.user.id}> - ${member.points || 0} point(s)\n`;
      }
    }

    const embed = createEmbed({ title: "Daily Problem Leaderboard", description: leaderboardText });
    if (!server.messageId) {
      console.log("updateLeaderboard: No previous leaderboard message; sending new one.");
      const message = await channel.send({ embeds: [embed] });
      server.messageId = message.id;
      await server.save();
      console.log("updateLeaderboard: New leaderboard message sent with ID", message.id);
    } else {
      console.log("updateLeaderboard: Attempting to fetch existing leaderboard message with ID:", server.messageId);
      const message = await channel.messages.fetch(server.messageId).catch((err) => {
        console.error("updateLeaderboard: Failed to fetch existing message:", err);
        return null;
      });
      if (message) {
        console.log("updateLeaderboard: Found existing leaderboard message; editing it.");
        await message.edit({ embeds: [embed] });
      } else {
        console.log("updateLeaderboard: Existing message not found; sending new leaderboard message.");
        const newMessage = await channel.send({ embeds: [embed] });
        server.messageId = newMessage.id;
        await server.save();
        console.log("updateLeaderboard: New leaderboard message sent with ID", newMessage.id);
      }
    }
    return true;
  } catch (error) {
    logError("updateLeaderboard", error);
    return false;
  }
}

// Fetch the user's last Codeforces submission
async function lastcfSubmission(handle: string): Promise<any | null> {
  const url = `https://codeforces.com/api/user.status?handle=${handle}&from=1&count=1`;
  try {
    const response = await axios.get(url);
    if (response.data.status === 'OK' && response.data.result.length > 0) {
      console.log("lastcfSubmission: Retrieved submission for handle", handle);
      return response.data.result[0];
    } else {
      console.error("lastcfSubmission: No submissions found for handle", handle);
    }
  } catch (error) {
    logError("lastcfSubmission", error);
  }
  return null;
}

// Get a random problem URL from Codeforces
async function getRandomProblemUrl(): Promise<[string, string] | null> {
  try {
    const apiUrl = 'https://codeforces.com/api/problemset.problems';
    const response = await axios.get(apiUrl);
    if (response.data.status === 'OK') {
      const problems = response.data.result.problems;
      const randomIndex = Math.floor(Math.random() * problems.length);
      const randomProblem = problems[randomIndex];
      const { contestId, index } = randomProblem;
      const problemUrl = `https://codeforces.com/contest/${contestId}/problem/${index}`;
      console.log("getRandomProblemUrl: Selected problem", contestId, index);
      return [problemUrl, `${contestId}/${index}`];
    } else {
      console.error('getRandomProblemUrl: Error fetching problems from Codeforces API:', response.data.comment);
      return null;
    }
  } catch (error) {
    logError("getRandomProblemUrl", error);
    return null;
  }
}

/**
 * getTotalUserCount: Summation of each guild's memberCount.
 */
function getTotalUserCount(): number {
  let totalUsers = 0;
  client.guilds.cache.forEach(g => {
    totalUsers += g.memberCount;
  });
  return totalUsers;
}

// Check if the user has solved a given problem
async function hasSolvedProblem(handle: string, problemId: string): Promise<boolean | null> {
  const [contestIdStr, index] = problemId.split('/');
  const contestId = parseInt(contestIdStr, 10);
  if (isNaN(contestId) || !index) {
    throw new Error('Invalid problemId format. Expected format "contestId/index".');
  }
  try {
    const url = `https://codeforces.com/api/user.status?handle=${handle}`;
    const response = await axios.get(url);
    if (response.data.status === 'OK') {
      const submissions = response.data.result;
      const solved = submissions.some((submission: { problem: any; verdict: any; }) => {
        const { problem, verdict } = submission;
        return problem.contestId === contestId && problem.index === index && verdict === 'OK';
      });
      console.log(`hasSolvedProblem: Handle ${handle} solved problem ${problemId}?`, solved);
      return solved;
    } else {
      console.error('hasSolvedProblem: Error fetching user submissions:', response.data.comment);
      return null;
    }
  } catch (error) {
    logError("hasSolvedProblem", error);
    return null;
  }
}

// When the bot is ready
client.on(Events.ClientReady, readyClient => {
  console.log(`Logged in as ${readyClient.user.tag}!`);
});

// When the bot joins a new guild, send a welcome message
client.on(Events.GuildCreate, async guild => {
  try {
    if (guild.systemChannel) {
      const embed = createEmbed({
        title: "Hello! Thanks for inviting me!",
        description: "I'm here to help you with Codeforces daily problems. Use `/help` to see what I can do!",
      });
      console.log("GuildCreate: Sending welcome message to systemChannel", guild.systemChannel.id);
      await guild.systemChannel.send({ embeds: [embed] });
    }
  } catch (error) {
    logError("GuildCreate", error);
  }
});

// Handle interactions (both commands and button presses)
client.on(Events.InteractionCreate, async (interaction: Interaction) => {
  try {
    // Handle button interactions
    if (interaction.isButton()) {
      const buttonInteraction = interaction as ButtonInteraction;
      if (buttonInteraction.customId.startsWith('done|')) {
        const parts = buttonInteraction.customId.split('|');
        const cfUsername = parts[1];
        const problemId = parts[2];
        const [contestId, problemIndex] = problemId.split('/');
        if (!cfUsername) {
          return await safeReply(buttonInteraction as unknown as ChatInputCommandInteraction, createEmbed({ description: 'Invalid Codeforces username.' }));
        }
        const lastSubmission = await lastcfSubmission(cfUsername);
        if (!lastSubmission) {
          return await safeReply(buttonInteraction as unknown as ChatInputCommandInteraction, createEmbed({ description: 'Could not retrieve your last submission. Please try again later.' }));
        }
        if (
          lastSubmission.problem.contestId.toString() === contestId &&
          lastSubmission.problem.index === problemIndex &&
          lastSubmission.verdict === 'COMPILATION_ERROR'
        ) {
          await new User({ id: buttonInteraction.user.id, cfUsername, guildId: buttonInteraction.guildId! }).save();
          return await safeReply(buttonInteraction as unknown as ChatInputCommandInteraction, createEmbed({ description: `You have now signed in!` }));
        } else {
          return await safeReply(buttonInteraction as unknown as ChatInputCommandInteraction, createEmbed({ description: `Your last submission does not match the problem or it wasn't a compilation error. Please try again.` }));
        }
      }
      return;
    }

    // Handle slash commands
    if (interaction.isChatInputCommand()) {
      if (!interaction.guildId) {
        return await safeReply(interaction as ChatInputCommandInteraction, createEmbed({ title: "Error", description: "This command can only be used in a server." }));
      }
      const cmdInteraction = interaction as ChatInputCommandInteraction;
      const { commandName } = cmdInteraction;

      if (commandName === 'ping') {
        try {
          const sent = await cmdInteraction.reply({
            embeds: [createEmbed({ description: 'Pinging...' })],
            fetchReply: true,
          });
          const ping = sent.createdTimestamp - cmdInteraction.createdTimestamp;
          const embed = createEmbed({
            description: `Pong! 🏓 Latency is \`${ping}ms\`. API Latency is \`${Math.round(client.ws.ping)}ms\``,
          });
          await cmdInteraction.editReply({ embeds: [embed] });
        } catch (error) {
          logError("ping", error);
          await safeReply(cmdInteraction, createEmbed({ description: "An error occurred while executing the ping command." }));
        }
      }

      else if (commandName === 'login') {
        try {
          const cfUsername = cmdInteraction.options.getString('handle');
          if (!cfUsername) {
            return await safeReply(cmdInteraction, createEmbed({ description: 'Please provide a Codeforces username.' }));
          }
          const problemResult = await getRandomProblemUrl();
          if (!problemResult) {
            return await safeReply(cmdInteraction, createEmbed({ description: 'Sorry, I could not fetch a random problem at the moment.' }));
          }
          const [url, problemId] = problemResult;
          const embed = createEmbed({
            description: `Please submit a compilation error to this problem: ${url}\nWhen you are done, please press the **Done** button.`,
          });
          await cmdInteraction.reply({
            embeds: [embed],
            ephemeral: true,
            components: [
              {
                type: 1,
                components: [
                  {
                    type: 2,
                    style: 1,
                    customId: `done|${cfUsername}|${problemId}`,
                    label: "Done",
                  },
                ],
              },
            ],
          });
        } catch (error) {
          logError("login", error);
          await safeReply(cmdInteraction, createEmbed({ description: "An error occurred while processing your login." }));
        }
      }

      else if (commandName === 'check') {
        try {
          const user = await User.findOne({ id: cmdInteraction.user.id });
          if (!user) {
            return await safeReply(cmdInteraction, createEmbed({ description: 'You are not logged in. Please use /login to log in.' }));
          }
          const server = await Server.findOne({ daily: { $exists: true }, guildId: cmdInteraction.guildId }).populate("members.user");
          if (!server || !server.daily) {
            return await safeReply(cmdInteraction, createEmbed({ description: 'No server found with a daily problem.' }));
          }
          const dailyProblemId = server.daily;
          const solved = await hasSolvedProblem(user.cfUsername, dailyProblemId);
          if (solved === null) {
            return await safeReply(cmdInteraction, createEmbed({ description: 'There was an error checking your submissions. Please try again later.' }));
          }
          const member = server.members.find((m: any) => m.user && m.user.id === user.id);
          let replyEmbed: EmbedBuilder;
          if (member && member.lastSubmitted === dailyProblemId) {
            replyEmbed = createEmbed({ description: 'You have already submitted your solution for this problem today.' });
          } else {
            if (!member) {
              server.members.push({
                user: user._id,
                points: solved ? 1 : 0,
                lastSubmitted: solved ? dailyProblemId : null,
              });
            } else {
              member.points += 1;
              member.lastSubmitted = dailyProblemId;
            }
            await server.save();
            replyEmbed = solved
              ? createEmbed({ description: 'Congratulations! You have solved the daily problem and earned 1 point.' })
              : createEmbed({ description: 'You have not solved the daily problem yet. Keep trying!' });
          }
          // Update leaderboard asynchronously (do not block the interaction reply)
          updateLeaderboard(cmdInteraction.guildId).catch(err => console.error("updateLeaderboard error:", err));
          return await safeReply(cmdInteraction, replyEmbed);
        } catch (error) {
          logError("check", error);
          await safeReply(cmdInteraction, createEmbed({ description: "An error occurred while checking your solution." }));
        }
      }

      else if (commandName === 'setdailyproblem') {
        try {
          if (!cmdInteraction.memberPermissions || !cmdInteraction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
            return await safeReply(cmdInteraction, createEmbed({ description: 'You do not have permission to set the daily problem.' }));
          }
          const problemUrl = cmdInteraction.options.getString('problem_url');
          if (!problemUrl) {
            return await safeReply(cmdInteraction, createEmbed({ description: 'Please provide a valid Codeforces problem URL.' }));
          }
          const regex = /\/(?:contest|problemset)\/problem\/(\d+)\/([A-Z0-9]+)/;
          const match = problemUrl.match(regex);
          if (!match) {
            return await safeReply(cmdInteraction, createEmbed({ description: 'Invalid problem URL format. Please provide a valid Codeforces problem URL.' }));
          }
          const contestId = match[1];
          const index = match[2];
          async function validateProblemUrl(contestId: string, index: string): Promise<boolean> {
            try {
              const response = await axios.get(`https://codeforces.com/api/problemset.problems`);
              if (response.data.status === 'OK') {
                const problems = response.data.result.problems;
                return problems.some((problem: any) => problem.contestId.toString() === contestId && problem.index === index);
              } else {
                console.error('setdailyproblem: Error fetching problems from Codeforces API:', response.data.comment);
                return false;
              }
            } catch (error) {
              logError("validateProblemUrl", error);
              return false;
            }
          }
          const isValidProblem = await validateProblemUrl(contestId, index);
          if (!isValidProblem) {
            return await safeReply(cmdInteraction, createEmbed({ description: 'The provided problem URL is not valid. Please provide a valid Codeforces problem URL.' }));
          }
          let server = await Server.findOne({ guildId: cmdInteraction.guildId });
          if (!server) {
            server = await Server.create({
              daily: `${contestId}/${index}`,
              guildId: cmdInteraction.guildId!,
            });
          } else {
            server.daily = `${contestId}/${index}`;
            await server.save();
          }
          const warnings: string[] = [];
          if (!server.announcementChannelId) {
            warnings.push("No announcement channel is set.");
          }
          if (!server.channelId) {
            warnings.push("No leaderboard channel is set.");
          }
          const announcementSuccess = await announce(cmdInteraction.guildId!);
          if (!announcementSuccess) {
            warnings.push("Failed to send announcement.");
          }
          let replyMsg = `Daily problem has been set to: ${problemUrl}`;
          if (warnings.length > 0) {
            replyMsg += `\nWarning: ${warnings.join(" ")}`;
          }
          return await safeReply(cmdInteraction, createEmbed({ description: replyMsg }));
        } catch (error) {
          logError("setdailyproblem", error);
          await safeReply(cmdInteraction, createEmbed({ description: "An error occurred while setting the daily problem." }));
        }
      }

      else if (commandName === 'setleaderboardchannel') {
        try {
          if (!cmdInteraction.memberPermissions || !cmdInteraction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
            return await safeReply(cmdInteraction, createEmbed({ description: 'You do not have permission to set the leaderboard channel.' }));
          }
          const channel = cmdInteraction.options.getChannel('channel');
          if (!channel || !('send' in channel)) {
            return await safeReply(cmdInteraction, createEmbed({ description: 'Please provide a valid text channel.' }));
          }
          let server = await Server.findOne({ guildId: cmdInteraction.guildId });
          if (!server) {
            server = await Server.create({
              guildId: cmdInteraction.guildId!,
              channelId: channel.id,
            });
          } else {
            server.channelId = channel.id;
          }
          await server.save();
          return await safeReply(cmdInteraction, createEmbed({ description: `Leaderboard channel has been set to <#${channel.id}>` }));
        } catch (error) {
          logError("setleaderboardchannel", error);
          await safeReply(cmdInteraction, createEmbed({ description: "An error occurred while setting the leaderboard channel." }));
        }
      }

      else if (commandName === 'setannouncementchannel') {
        try {
          if (!cmdInteraction.memberPermissions || !cmdInteraction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
            return await safeReply(cmdInteraction, createEmbed({ description: 'You do not have permission to set the announcement channel.' }));
          }
          const channel = cmdInteraction.options.getChannel('channel');
          if (!channel || !('send' in channel)) {
            return await safeReply(cmdInteraction, createEmbed({ description: 'Please provide a valid text channel.' }));
          }
          let server = await Server.findOne({ guildId: cmdInteraction.guildId });
          if (!server) {
            server = await Server.create({
              guildId: cmdInteraction.guildId!,
              announcementChannelId: channel.id,
            });
          } else {
            server.announcementChannelId = channel.id;
          }
          await server.save();
          return await safeReply(cmdInteraction, createEmbed({ description: `Announcement channel has been set to <#${channel.id}>` }));
        } catch (error) {
          logError("setannouncementchannel", error);
          await safeReply(cmdInteraction, createEmbed({ description: "An error occurred while setting the announcement channel." }));
        }
      }

      /**
       * Public help command: Displays an embed with fields for each command.
       */
      else if (commandName === 'help') {
        try {
          const helpEmbed = new EmbedBuilder()
            .setTitle("Help")
            .setColor(DEFAULT_EMBED_CONFIG.color)
            .setFooter({
              text: DEFAULT_EMBED_CONFIG.footer.text,
              iconURL: DEFAULT_EMBED_CONFIG.footer.iconURL,
            })
            .setDescription("Here are the available commands:")
            .addFields(
              { name: "/ping", value: "Check bot latency." },
              { name: "/login", value: "Connect your Codeforces account. Usage: /login handle:<your_handle>" },
              { name: "/check", value: "Check if you've solved the daily problem." },
              { name: "/setdailyproblem", value: "Set the daily Codeforces problem. (Admin only)" },
              { name: "/setleaderboardchannel", value: "Set the channel for the leaderboard. (Admin only)" },
              { name: "/setannouncementchannel", value: "Set the channel for announcements. (Admin only)" },
              { name: "/botinfo", value: "Show info about this bot." },
              { name: "/leaderboard", value: "Display the current leaderboard." }
            );
          return await safeReplyEmbed(cmdInteraction, helpEmbed, false);
        } catch (error) {
          logError("help", error);
          await safeReply(cmdInteraction, createEmbed({ description: "An error occurred while displaying help information." }), undefined, false);
        }
      }

      /**
       * Botinfo command:
       * - Displays 7 pieces of info in fields.
       * - The embed thumbnail is set to the bot's avatar.
       * - The description includes your website.
       */
      else if (commandName === 'botinfo') {
        try {
          const uptimeSeconds = process.uptime();
          const uptimeFormatted = formatUptime(uptimeSeconds);
          const serverCount = client.guilds.cache.size;
          const userCount = getTotalUserCount();
          const apiLatency = Math.round(client.ws.ping);
          const nodeVersion = process.version;
          const usedMemMB = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
  
          const botinfoEmbed = new EmbedBuilder()
            .setTitle("Bot Info")
            .setColor(DEFAULT_EMBED_CONFIG.color)
            .setFooter({
              text: DEFAULT_EMBED_CONFIG.footer.text,
              iconURL: DEFAULT_EMBED_CONFIG.footer.iconURL,
            })
            .setThumbnail(client.user?.displayAvatarURL() || "")
            .setDescription("Visit my website: [spral.dev](https://spral.dev)")
            .addFields(
              { name: "Uptime", value: uptimeFormatted, inline: true },
              { name: "Servers", value: serverCount.toString(), inline: true },
              { name: "Users", value: userCount.toString(), inline: true },
              { name: "Node Version", value: nodeVersion, inline: true },
              { name: "Memory Usage", value: `${usedMemMB} MB`, inline: true },
              { name: "API Latency", value: `${apiLatency} ms`, inline: true },
              { name: "Discord.js Version", value: discordVersion, inline: true }
            );
  
          return await safeReplyEmbed(cmdInteraction, botinfoEmbed, false);
        } catch (error) {
          logError("botinfo", error);
          await safeReply(cmdInteraction, createEmbed({ description: "An error occurred while fetching bot info." }), undefined, false);
        }
      }

      /**
       * New /leaderboard command: Publicly displays the current leaderboard.
       */
      else if (commandName === 'leaderboard') {
        try {
          const server = await Server.findOne({ guildId: cmdInteraction.guildId }).populate("members.user");
          if (!server || !server.daily) {
            return await cmdInteraction.reply({ embeds: [createEmbed({ description: "No daily problem is set for this server." })], ephemeral: false });
          }
          if (!server.members || server.members.length === 0) {
            return await cmdInteraction.reply({ embeds: [createEmbed({ title: "Leaderboard", description: "No members have solved the daily problem yet." })], ephemeral: false });
          }
          // Sort members and build leaderboard text
          server.members.sort((a: any, b: any) => (b.points || 0) - (a.points || 0));
          let leaderboardText = "**Leaderboard for Daily Problem**\n\n";
          let currentRank = 0;
          let lastPoints = -1;
          for (let i = 0; i < server.members.length; i++) {
            const member = server.members[i];
            if (member.user) {
              if (member.points !== lastPoints) {
                currentRank = i + 1;
                lastPoints = member.points;
              }
              leaderboardText += `${currentRank}. <@${member.user.id}> - ${member.points || 0} point(s)\n`;
            }
          }
      
          const leaderboardEmbed = createEmbed({ title: "Daily Problem Leaderboard", description: leaderboardText });
          return await cmdInteraction.reply({ embeds: [leaderboardEmbed], ephemeral: false });
        } catch (error) {
          logError("leaderboard", error);
          return await safeReplyEmbed(cmdInteraction, createEmbed({ title: "Leaderboard", description: "An error occurred while fetching the leaderboard." }), false);
        }
      }
    }
  } catch (error) {
    logError("InteractionCreate", error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        embeds: [createEmbed({ title: "Error", description: "An unexpected error occurred. Please try again later." })],
        ephemeral: true,
      });
    }
  }
});

// Initialize database and login
async function init() {
  try {
    await ConnectDB();
    await client.login(process.env.DISCORD_BOT_TOKEN);
  } catch (error) {
    logError("init", error);
    process.exit(1);
  }
}

init().catch(err => logError("init catch", err));
