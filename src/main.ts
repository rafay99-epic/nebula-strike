import { Game } from './core/Game';

const container = document.getElementById('app');
if (!container) throw new Error('Missing #app container');

const game = new Game(container);
game.start();

// handle for automated smoke tests (TS-private fields are reachable at runtime)
(window as unknown as { __NEBULA: Game }).__NEBULA = game;
