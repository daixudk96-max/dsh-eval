'use strict';
const { EvolutionController } = require('./lib/controller');
const { evaluateGate } = require('./lib/gate');
const { TRANSITIONS, canTransition, assertTransition } = require('./lib/state-machine');

module.exports = { EvolutionController, evaluateGate, TRANSITIONS, canTransition, assertTransition };
