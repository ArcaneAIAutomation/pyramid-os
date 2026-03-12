/**
 * Basic tests for the PYRAMID OS main entry point.
 * Verifies the module can be imported and exports are correct.
 */

import { describe, it, expect } from 'vitest';
import { main, type PyramidOSContext } from '../main.js';

describe('main module', () => {
  it('exports the main function', () => {
    expect(typeof main).toBe('function');
  });

  it('main is an async function', () => {
    expect(main.constructor.name).toBe('AsyncFunction');
  });
});
