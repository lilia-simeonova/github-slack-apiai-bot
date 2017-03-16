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
var GitHub = require('github-api');

const Entities = require('html-entities').XmlEntities;
const decoder = new Entities();

const apiAiAccessToken = "cae28d128f6a410280e9f9ba275fbfbc";

const slackBotKey = "xoxb-155149966694-uT42Cr8Isk8gWbXq47HVF0cd";

var github = new GitHub({ token: "a5bf648dd8e0e838b9b9632a80a25c146928848e"});

const devConfig = process.env.DEVELOPMENT_CONFIG == 'true';

const npmKeyword = require('npm-keyword');

//var github = new GitHub({ token: "github-api-token"});

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

const TimeOutError = 'I couldn\'t resolve your request';
const TimeoutDuration = 5000;

function timeoutAfter(duration) {
  return new Promise((_, reject) => setTimeout(() => reject(TimeOutError), duration));
}

function firstReady(...promises) {
  let completed = false;
  const complete = f => {
    return result => {
      if (!completed) {
        completed = true;
        f(result);
      }
    };
  };
  return new Promise((resolve, reject) => {
    promises.forEach(p => {
      p.then(complete(resolve), complete(reject));
    });
  });
}

controller.hears(['.*'], ['direct_message', 'direct_mention', 'mention', 'ambient'], (bot, message) => {
  try {
    if (message.type == 'message') {
      if (message.user == bot.identity.id) {
         // message from bot can be skipped
      } else if (message.text.indexOf("<@U") == 0 && message.text.indexOf(bot.identity.id) == -1) {
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
            console.log('action is:', action);
            
            if (action === 'search') {
              let searchProject = response.result.parameters['searchProject'];
              let searchUser = response.result.parameters['searchUser'];
              let text = response.result.parameters['text'][0];
              var search = github.search();
              if (searchProject) {
                console.log(searchProject, text)
                firstReady(
                  search.forRepositories({ q: text, sort: 'stars', order: 'desc' }),
                    timeoutAfter(TimeoutDuration)
                  )
                  .then(r => { 
                    if (r.data) {
                      responseText = 'Here are the first 3 result:' + '\n' + r.data[0]['full_name'] + '\n' + r.data[1]['full_name'] + '\n' + r.data[2]['full_name'];
                      bot.reply(message, responseText);
                    } else {
                      responseText = 'Sorry, I can\'t find project related to ' + text + '. Please try one more time';
                      bot.reply(message, responseText); 
                    }
                  })
                  .catch(e => {
                    console.log('Something went wrong');
                    bot.reply(message, e)
                  });
              } else if (searchUser) {
                  search.forUsers({ q: text}).then(
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
            } else if(action === 'follow') {
              var result = response.result.parameters['text'];
              console.log('result is:',result);
              if(result) {
                  //console.log(result);
                var user = github.getUser(result);
                  //console.log(user);
                user.follow().then( 
                r => { 
                  console.log(r);
                  if(r) {
                    let responseText = 'You successfuly followed ' + result;
                    bot.reply(message, responseText);
                  } else {
                    responseText = 'There was some problem. Please try again.';
                    bot.reply(message, responseText);
                  }  
                });
              }   
            } else if(action === 'createRepo') {
              var result = response.result.parameters['text'];
              if(result) {
                console.log(result);
                var user = github.getUser();
                user.createRepo({name: result}).then( r => {
                  console.log(r);
                  let responseText = "You successfuly created repo " + result;
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