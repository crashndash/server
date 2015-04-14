'use strict';
var crypto = require('crypto');

module.exports = function(user, version, count) {
  user = user || '';
  version = version || '';
  count = count || '';
  return crypto.createHash('md5')
    .update(user + version + count)
    .digest('hex');
};
