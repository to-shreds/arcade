import { chooseCpuAction } from './engine.js';

self.onmessage = event => {
  const { id, game, difficulty } = event.data || {};
  try { self.postMessage({ id, action: chooseCpuAction(game, difficulty) }); }
  catch (error) { self.postMessage({ id, error: error.message || 'The computer could not choose a move.' }); }
};
