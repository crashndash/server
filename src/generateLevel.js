'use strict';
var seed = require('seed-random');

module.exports = function(name) {
  // Generate some random stuff.
  var random = seed(name);
  // Generate number from 0 to 60.
  var totalPowerUps = Math.floor(random() * 60);
  // We want at least 15 power ups.
  if (totalPowerUps < 15) {
    totalPowerUps = 15;
  }
  var powerUps = [];
  while (powerUps.length < totalPowerUps) {
    powerUps.push([
      Math.floor(random() * 100),
      Math.ceil(random() * 4)
    ]);
  }
  // OK. Let's do blocks.
  var totalBlocks = Math.floor(random() * 20);
  var blocks = [];
  // ...at least 5 blocks.
  if (totalBlocks < 5) {
    totalBlocks = 5;
  }
  while (blocks.length < totalBlocks) {
    blocks.push(Math.floor(random() * 100));
  }
  return {
    blocks: blocks,
    powerUps: powerUps
  };
};
