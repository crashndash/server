'use strict';
var crypto = require('crypto');
var customHash;

module.exports = function(config) {
  return function(user, version, count) {
    var correctHash;
    /*istanbul ignore else*/
    if (config.customHash) {
      if (!customHash) {
        customHash = require('../' + config.customHash);
      }
      // If this now throws something, then that is prabably just as well.
      correctHash = customHash(user, version, count);
    }
    else {
      correctHash = crypto.createHash('md5')
      .update(user + version + count + config.secret)
      .digest('hex');
    }
    return correctHash;
  };
};
