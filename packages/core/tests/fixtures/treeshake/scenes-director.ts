// Only the scene director: no shader transitions, no gsap, no pylinka.
import { SceneDirector } from '../../../src/scenes/index';

(globalThis as Record<string, unknown>).__fixture = SceneDirector;
