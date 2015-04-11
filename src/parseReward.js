'use strict';

module.exports = function(data, app) {
  var op = data[0];
  var user = data[1];
  if (op === 'delete' && app.data.rewards[user]) {
    delete app.data.rewards[user];
    return;
  }
  /* istanbul ignore else */
  if (op === 'new') {
    var points = data[2];
    app.data.rewards[user] = app.data.rewards[user] || 0;
    app.data.rewards[user] += points;
  }
};
