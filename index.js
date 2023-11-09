const { Client, GatewayIntentBits, EmbedBuilder, Events, Partials } = require('discord.js');
const fs = require('fs');
const yaml = require('js-yaml');
const axios = require('axios')

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessageReactions],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

// Runs upon bot startup
client.on('ready', async () => {
    logMessage(`Logged in as ${client.user.tag}!`);

    // Initially Refresh live update
    liveUpdate();

    // Set node and panel scan
    var pteroScan = setInterval(function() { 
        logMessage('Checking status.');
        logMessage('Previous Panel Status: '+panelStatus);
        logMessage('Previous Node Statuses: '+JSON.stringify(nodeStatus));

        // Refresh live update
        liveUpdate();
    }, config.pterodactyl.refresh * 1000);
});

// Get the configuration file
var config;
try {
    // Read the YAML configuration file
    const configFile = fs.readFileSync('./configuration.yml', 'utf8');

    // Parse the YAML content
    config = yaml.load(configFile);
} catch (e) {
    console.error('Error reading or parsing the configuration file:', e);
    process.exit()
}

// Get the server configuration file
var serverConfig;
try {
    // Read the YAML configuration file
    const configFile = fs.readFileSync('./SERVER_CONFIG.yml', 'utf8');

    // Parse the YAML content
    serverConfig = yaml.load(configFile);
} catch (e) {
    console.error('Error reading or parsing the server configuration file:', e);
    process.exit()
}

// Deal with the live message
async function liveUpdate(){
    // Check if we have a live message
    if(serverConfig.liveMessage == ''){
        // We need to send the live update message
        const channel = client.channels.cache.get(config.discordServer.liveChannelID);
  
        if (channel){
            var embed = new EmbedBuilder()
                .setTitle(config.liveMessage.title)
                .setDescription(config.liveMessage.description)
                .setFooter({ text: config.liveMessage.footer })
                .setColor(config.liveMessage.colour);
                // .setImage(config.liveMessage.image)
                // .setThumbnail(config.liveMessage.image);
    
            if(config.liveMessage.timestamp){
                embed.setTimestamp();
            }
      
            // Get message ID
            const sentMessage = await channel.send({ embeds: [embed] });

            // Update the live message ID
            serverConfig.liveMessage = sentMessage.id;

            // Update the live message ID in the file
            try {
                const configFileContent = fs.readFileSync('./SERVER_CONFIG.yml', 'utf8');
                const config = yaml.load(configFileContent);

                config.liveMessage = sentMessage.id;

                const updatedConfigYAML = yaml.dump(config);

                fs.writeFileSync('./SERVER_CONFIG.yml', updatedConfigYAML, 'utf8');
            } catch (e) {
                console.error('Error reading or updating the configuration file:', e);
            }

            // Re-add the comments that were removed
            fs.readFile('./SERVER_CONFIG.yml', 'utf-8', function(err, data) {
                if (err) throw err;
             
                var newValue = "# WARNING DO NOT EDIT THIS FILE. THIS FILE IS IMPORANT FOR STORING INFOMATION REQUIRED. PELASE EDIT THE configuration.yml FILE TO EDIT ANY SETTINGS\n"+data
             
                fs.writeFile('./SERVER_CONFIG.yml', newValue, 'utf-8', function(err, data) {
                    if (err) throw err;
                })
            })
        }
    } else{
        // Update the message
        const channel = client.channels.cache.get(config.discordServer.liveChannelID);
        const messageId = serverConfig.liveMessage;

        try {
            const targetMessage = await channel.messages.fetch(messageId);
            if (targetMessage) {
                const timeGen = Math.floor(Date.now() / 1000) + config.pterodactyl.refresh;
                var description = config.liveMessage.description+`\n\nNext update <t:${timeGen}:R>\n\n**Panel**: `;
                getPanelStatus(function(){
                    if(panelStatus){
                        description += config.statusText.online;
                    } else{
                        description += config.statusText.offline;
                    }

                    description += "\n\n";

                    getNodeStatus(function(){
                        for (const [nodeID, localNodeStatus] of Object.entries(nodeStatus)) {
                            description += `**${nodeNames[nodeID]}: **`;
                            if(localNodeStatus){
                                description += config.statusText.online+'\n```Disk : '+roundToDecimalPlace(allNodes[nodeID].diskUsed / 1024/ 1024 / 1024, 1)+' GB / '+allNodes[nodeID].disk / 1024+' GB\nServers : '+allNodes[nodeID].serversCount+'```';
                            } else{
                                description += config.statusText.offline+'\n```Disk : '+roundToDecimalPlace(allNodes[nodeID].diskUsed / 1024/ 1024 / 1024, 1)+' GB / '+allNodes[nodeID].disk / 1024+' GB\nServers : '+allNodes[nodeID].serversCount+'```';
                            }
                        }
                        
                        var editedEmbed = new EmbedBuilder()
                        .setTitle(config.liveMessage.title)
                        .setDescription(description)
                        .setFooter({ text: config.liveMessage.footer })
                        .setColor(config.liveMessage.colour);
                        // .setImage(config.liveMessage.image)
                        // .setThumbnail(config.liveMessage.image);
            
                        if(config.liveMessage.timestamp){
                            editedEmbed.setTimestamp();
                        }
            
                        // Modify the embed in the target message
                        targetMessage.edit({ embeds: [editedEmbed] });
                    });
                });
            } else {
              console.log('Message not found.');
            }
          } catch (error) {
            console.error('Error editing the message:', error);
          }
    }
}

function roundToDecimalPlace(number, decimalPlaces) {
    return Number(number.toFixed(decimalPlaces));
}

// Get panel status
var panelStatus = true;

function getPanelStatus(callback){
    axios(config.pterodactyl.url + '/api/application/nodes', {
        method: 'GET',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + config.pterodactyl.apiKey
        }
    }).then(() => {
        if(panelStatus == false){
            sendEmbed('Panel', true);
        }
        logMessage('Panel scan suggests online');
        panelStatus = true;
        callback();
    }).catch(() => {
        if(panelStatus == true){
            sendEmbed('Panel', false);
        }
        logMessage('Panel scan suggests offline');
        panelStatus = false;
        callback();
    });
}

// Function for a custom chat message
function logMessage(message) {
    console.log('\x1b[36m%s\x1b[0m', '['+config.loggingName+']', '\x1b[32m' + message);
}

// Get node status'
var nodeStatus = {};
var nodeNames = {};
var allNodes = {};

function getNodeStatus(callback){
    axios(config.pterodactyl.url + '/api/application/nodes?per_page=99999999999999', { // per_page being high prevenets only the first few nodes being scanned
        method: 'GET',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + config.pterodactyl.apiKey
        }
    }).then((data) => {
        const nodes = data.data.data; // First .data is for the data of the requests, second is for pterodactyl

        nodes.forEach(node => {
            if(node.object == 'node'){
                const id = node.attributes.id;
                const public = node.attributes.public;
                const maintenanceMode = node.attributes.maintenance_mode;
                const name = node.attributes.name;
                const fqdn = node.attributes.fqdn;
                const scheme = node.attributes.scheme;
                const port = node.attributes.daemon_listen;
                const disk = node.attributes.disk;

                axios(config.pterodactyl.url + '/api/application/nodes/' + id + '/configuration', {
                    method: 'GET',
                    headers: {
                        Accept: 'application/json',
                        'Content-Type': 'application/json',
                        Authorization: 'Bearer ' + config.pterodactyl.apiKey
                    }
                }).then((data) => {
                    const token = data.data.token;
                    axios(scheme+'://'+fqdn+':'+port+'/api/servers', {
                        method: 'GET',
                        headers: {
                            Accept: 'application/json',
                            'Content-Type': 'application/json',
                            Authorization: 'Bearer ' + token
                        }
                    }).then((data) => {
                        // No response means that the node is offline.
                        if(nodeStatus[id] == false){
                            sendEmbed(name, true);
                        }
                        // Need to count the amount of servers and disk used
                        var serversCount = 0;
                        var diskUsed = 0;
                        
                        data.data.forEach(server => {
                            serversCount++;
                            diskUsed += parseInt(server.utilization.disk_bytes);
                        });

                        logMessage('Node scan suggests node \''+name+'\' is online');
                        allNodes[id] = {id: id, public: public, maintenanceMode: maintenanceMode, name: name, fqdn: fqdn, scheme: scheme, port: port, disk: disk, serversCount: serversCount, diskUsed: diskUsed};
                        nodeStatus[id] = true;
                        nodeNames[id] = name;
                        callback();
                    }).catch((error) => {
                        // No response means that the node is offline.
                        if(nodeStatus[id] == true){
                            sendEmbed(name, false);
                        }
                        logMessage('Node scan suggests node \''+name+'\' is offline');
                        allNodes[id] = {id: id, public: public, maintenanceMode: maintenanceMode, name: name, fqdn: fqdn, scheme: scheme, port: port, disk: disk};
                        nodeStatus[id] = false;
                        nodeNames[id] = name;
                        callback();
                    });
                }).catch(() => {
                    // No response means that the panel is offline. I know we are checking nodes, but the panel hsa gone offline
                    if(panelStatus == true){
                        sendEmbed('Panel', false);
                    }
                    logMessage('Node scan suggests panel is offline');
                    panelStatus = false;
                });
            }
        });
    }).catch((error) => {
        // No response means that the panel is offline. I know we are checking nodes, but the panel hsa gone offline
        if(panelStatus == true){
            sendEmbed('Panel', false);
        }
        logMessage('Node scan suggests panel is offline');
        panelStatus = false;
        callback();
    });
}

// Function to send the message embed
function sendEmbed(itemName, status){
    const channel = client.channels.cache.get(config.discordServer.channelID);
  
    if (channel){
        const statusText = status ? 'online' : 'offline';
        var embed = new EmbedBuilder()
            .setTitle(config.statusMessage[statusText].title.replace(/{name}/g, itemName))
            .setDescription(config.statusMessage[statusText].description.replace(/{name}/g, itemName))
            .setFooter({ text: config.statusMessage[statusText].footer.replace(/{name}/g, itemName) })
            .setColor(config.statusMessage[statusText].colour);
            // .setImage(config.statusMessage[statusText].image)
            // .setThumbnail(config.statusMessage[statusText].image);

        if(config.statusMessage[statusText].timestamp){
            embed.setTimestamp();
        }
  
        channel.send({ embeds: [embed] });
    }
}

// Start the discord bot
client.login(config.discordBot.token);