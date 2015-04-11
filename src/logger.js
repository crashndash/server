'use strict';
var bunyan = require('bunyan');
var log = bunyan.createLogger({name: 'crashndashgame'});

module.exports = function(string, severity) {
  if (severity && log[severity]) {
    log[severity](string);
  }
  else {
    log.info(string);
  }
};
