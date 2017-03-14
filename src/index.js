// Module must be started with environment variables
//
//  accesskey="api.ai client access key"
//  slackkey="slack bot key"
//

'use strict';

const Botkit = require('botkit');

const apiai = require('apiai');
const uuid = require('node-uuid');

const http = require('http');
var axios = require('axios');

const Entities = require('html-entities').XmlEntities;
const decoder = new Entities();

const apiAiAccessToken = "apiai-token";
const slackBotKey = "slack-token";

const devConfig = process.env.DEVELOPMENT_CONFIG == 'true';

const npmKeyword = require('npm-keyword');

var GitHub = require('github-api');

var github = new GitHub({ token: "github-api-token"});

const apiaiOptions = {};

if (devConfig) {
    apiaiOptions.hostname = process.env.DEVELOPMENT_HOST;
    apiaiOptions.path = "/api/query";
}

const apiAiService = apiai(apiAiAccessToken, apiaiOptions);



const sessionIds = new Map();

const controller = Botkit.slackbot({
    debug: false
    //include "log: false" to disable logging
});



var bot = controller.spawn({
    token: slackBotKey
}).startRTM();


function isDefined(obj) {
    if (typeof obj == 'undefined') {
        return false;
    }

    if (!obj) {
        return false;
    }

    return obj != null;
}

controller.hears(['.*'], ['direct_message', 'direct_mention', 'mention', 'ambient'], (bot, message) => {
    try {
        if (message.type == 'message') {
            if (message.user == bot.identity.id) {
                // message from bot can be skipped
            }
            else if (message.text.indexOf("<@U") == 0 && message.text.indexOf(bot.identity.id) == -1) {
                // skip other users direct mentions
            }
            else {

                let requestText = decoder.decode(message.text);
                requestText = requestText.replace("’", "'");
                let channel = message.channel;
                let messageType = message.event;
                let botId = '<@' + bot.identity.id + '>';
                let userId = message.user;

                if (requestText.indexOf(botId) > -1) {
                    requestText = requestText.replace(botId, '');
                }

                if (!sessionIds.has(channel)) {
                    sessionIds.set(channel, uuid.v1());
                }

                console.log('Start request ', requestText);
                let request = apiAiService.textRequest(requestText,
                    {
                        sessionId: sessionIds.get(channel),
                        contexts: [
                            {
                                name: "generic",
                                parameters: {
                                    slack_user_id: userId,
                                    slack_channel: channel
                                }
                            }
                        ]
                    });

                request.on('response', (response) => {

                    if (isDefined(response.result)) {
                        let responseText = response.result.fulfillment.speech;
                        let responseData = response.result.fulfillment.data;
                        let action = response.result.action;
                        let parameters = response.result.parameters;

                        if(action === 'search') {
                            let searchProject = response.result.parameters['searchProject'];
                            let searchUser = response.result.parameters['searchUser'];
                            let text = response.result.parameters['text'][0];
                            var search = github.search();
                            if(searchProject) {
                                search.forRepositories({ q: text, sort: 'stars', order: 'desc' })
                                    .then(
                                        r => { 
                                            if(r.data) {
                                                responseText = 'Here are the first 3 result:' + '\n' + r.data[0]['full_name'] + '\n' + r.data[1]['full_name'] + '\n' + r.data[2]['full_name'];
                                                bot.reply(message, responseText);
                                            } else {
                                                responseText = 'Sorry, I can\'t find project related to ' + text + '. Please try one more time';
                                                bot.reply(message, responseText); 
                                            }
                                        });
                            }
                            if(searchUser) {
                                search.forUsers({ q: text})   
                                    .then( 
                                        r => {
                                            let user = r.data[0]['html_url'];
                                            console.log(user);
                                            if(user) {
                                                let responseText = user;
                                                bot.reply(message, responseText);
                                            } else {
                                                let responseText = 'I can\'t find this user\'s profile, please try again';
                                                bot.reply(message, responseText);
                                            }         
                                        })       
                            }
                        }
                        if(action === 'follow') {
                            var result = response.result.parameters['text'];
                            if(result) {
                                var user = github.getUser(result); // no user specified defaults to the user for whom credentials were provided 
                                user.follow().then( r => {
                                    if(r) {
                                        responseText = 'You successfuly followed ' + result;
                                        bot.reply(message, responseText);
                                    } else {
                                        responseText = 'There was some problem. Please try again.';
                                        bot.reply(message, responseText);
                                    }
                                });
                            }
                            
                        }
                        if(action === 'createRepo') {
                            var result = response.result.parameters['text'];
                            if(result) {
                                console.log(result);
                              //  var pr = github._getContentObject(result); // no user specified defaults to the user for whom credentials were provided 
                                github.createProject("random").then( r => {
                                    console.log(r);
                                        let responseText = "You successfuly created project " + result;
                                        bot.reply(message, responseText);
                                    });
                            }
                            
                        }
                        if (isDefined(responseData) && isDefined(responseData.slack)) {
                            try{
                                bot.reply(message, responseData.slack);
                            } catch (err) {
                                bot.reply(message, err.message);
                            }
                        } else if (isDefined(responseText)) {
                            bot.reply(message, responseText, (err, resp) => {
                                if (err) {
                                    console.error(err);
                                }
                            });
                        }

                    }
                });

                request.on('error', (error) => console.error(error));
                request.end();
            }
        }
    } catch (err) {
        console.error(err);
    }
});


//Create a server to prevent Heroku kills the bot
const server = http.createServer((req, res) => res.end());

//Lets start our server
server.listen((process.env.PORT || 5000), () => console.log("Server listening"));