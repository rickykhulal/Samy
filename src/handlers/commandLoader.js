import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { Collection } from 'discord.js';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);






function getSubcommandInfo(commandData) {
    const subcommands = [];
    
    if (commandData.options) {
        for (const option of commandData.options) {
if (option.type === 1) {
                subcommands.push(option.name);
} else if (option.type === 2) {
                if (option.options) {
                    for (const subOption of option.options) {
if (subOption.type === 1) {
                            subcommands.push(`${option.name}/${subOption.name}`);
                        }
                    }
                }
            }
        }
    }
    
    return subcommands;
}







async function getAllFiles(directory, fileList = []) {
    const files = await fs.readdir(directory, { withFileTypes: true });
    
    for (const file of files) {
        const filePath = path.join(directory, file.name);
        
        if (file.isDirectory()) {
            if (file.name === 'modules') {
                continue;
            }
            await getAllFiles(filePath, fileList);
        } else if (file.name.endsWith('.js')) {
            fileList.push(filePath);
        }
    }
    
    return fileList;
}






export async function loadCommands(client) {
    client.commands = new Collection();
    const commandsPath = path.join(__dirname, '../commands');
    const commandFiles = await getAllFiles(commandsPath);
    
    logger.info(`Found ${commandFiles.length} command files to load`);
    
    const uniqueCommandNames = new Set();
    
    for (const filePath of commandFiles) {
        try {
            const normalizedPath = filePath.replace(/\\/g, '/');
            
            const commandName = path.basename(filePath, '.js');
            const commandDir = path.dirname(filePath);
            const category = path.basename(commandDir);
            
            const commandModule = await import(`file://${filePath}`);
            const command = commandModule.default || commandModule;
            
            if (!command.data || !command.execute) {
                logger.warn(`Command at ${filePath} is missing required "data" or "execute" property.`);
                continue;
            }
            
            command.category = category;
            command.filePath = normalizedPath;
            
            const primaryCommandName = command.data.name;
            
            if (!uniqueCommandNames.has(primaryCommandName)) {
                uniqueCommandNames.add(primaryCommandName);
                
                client.commands.set(primaryCommandName, command);
            }
            
            const subcommands = getSubcommandInfo(command.data.toJSON());
            
            logger.info(`Loaded command: ${primaryCommandName} from ${normalizedPath} (category: ${category})`);
            
            if (subcommands.length > 0) {
                logger.info(`  - Subcommands: ${subcommands.join(', ')}`);
            }
            
        } catch (error) {
            logger.error(`Error loading command from ${filePath}:`, error);
        }
    }
    
    const commandsWithSubcommands = Array.from(client.commands.values()).filter(cmd => {
        const subcommands = getSubcommandInfo(cmd.data.toJSON());
        return subcommands.length > 0;
    });
    
    const totalSubcommands = commandsWithSubcommands.reduce((total, cmd) => {
        return total + getSubcommandInfo(cmd.data.toJSON()).length;
    }, 0);
    
    const uniqueCommands = new Set();
    for (const [name, command] of client.commands.entries()) {
        if (command.data && command.data.name) {
            uniqueCommands.add(command.data.name);
        }
    }
    
    logger.info(`Loaded ${uniqueCommands.size} commands`);
    return client.commands;
}







export async function registerCommands(client, guildId) {
    try {
        const commands = [];
        let totalSubcommands = 0;
const registeredNames = new Set();
        
        for (const command of client.commands.values()) {
            if (command.data && typeof command.data.toJSON === 'function') {
                const commandName = command.data.name;
                
                logger.debug(`Processing command for registration: ${commandName}`);
                
                if (!registeredNames.has(commandName)) {
                    registeredNames.add(commandName);
                    const commandJson = command.data.toJSON();
                    commands.push(commandJson);
                    
                    const subcommands = getSubcommandInfo(commandJson);
                    totalSubcommands += subcommands.length;
                    
                    if (process.env.NODE_ENV !== 'production') {
                        logger.debug(`Registering command: ${commandName}`);
                    }
                } else {
                    logger.debug(`Skipping duplicate command: ${commandName}`);
                }
            } else {
                logger.warn(`Command missing data or toJSON method: ${command}`);
            }
        }
        
        const totalCommandsWithSubs = commands.length + totalSubcommands;
        logger.info('Command validation passed');

        const guildIds = guildId.split(',');

        for (const id of guildIds) {
            try {
                const guild = await client.guilds.fetch(id.trim());
                const existingCommands = await guild.commands.fetch();
                logger.info(`Found ${existingCommands.size} existing guild commands in ${guild.name}`);
                await guild.commands.set(commands);
                logger.info(`Successfully registered ${commands.length} commands in ${guild.name}`);
            } catch (error) {
                logger.error(`Failed to register commands in guild ${id}:`, error);
            }
        }
    } catch (error) {
        logger.error('Error registering commands:', error);
        throw error;
    }
}







export async function reloadCommand(client, commandName) {
    const command = client.commands.get(commandName);
    
    if (!command) {
        return { success: false, message: `Command "${commandName}" not found` };
    }
    
    try {
        const commandPath = path.resolve(command.filePath);
        const moduleUrl = pathToFileURL(commandPath);
        moduleUrl.searchParams.set('t', Date.now().toString());

        const newCommand = (await import(moduleUrl.href)).default;
        
        client.commands.set(commandName, newCommand);
        
        logger.info(`Reloaded command: ${commandName}`);
        return { success: true, message: `Successfully reloaded command "${commandName}"` };
    } catch (error) {
        logger.error(`Error reloading command "${commandName}":`, error);
        return { success: false, message: `Error reloading command: ${error.message}` };
    }
}


