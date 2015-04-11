'use strict';
module.exports = function(user, app) {
  // Client receiving newuser messages.
  /* istanbul ignore next */
  app.data.users[user.id] = app.data.users[user.id] || {};
  /* istanbul ignore else */
  if (user.name && user.name.length > 0) {
    // Only update name if name is published.
    app.data.users[user.id].name = user.name;
  }
  if (user.room && user.room.length > 0) {
    // Only update room if room is published.
    app.data.users[user.id].room = user.room;
  }
  app.data.users[user.id].time = user.timestamp;
};
