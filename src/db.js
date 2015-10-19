'use strict';
var redisOptions = {
  port: 6379,
  host: process.env.REDIS_ENV || 'localhost'
};

var redis = require('redis');
var client = redis.createClient(redisOptions.port, redisOptions.host);

/* istanbul ignore next */
client.on('error', function (err) {
  console.log('Error ' + err);
});

module.exports = client;
