import { expect, it } from 'vitest';
import { readConfig, BootError } from './env';

it('refuses to boot without ORIGIN', () => {
	expect(() => readConfig({})).toThrow(BootError);
	expect(readConfig({ ORIGIN: 'https://x.example/' }).origin).toBe('https://x.example');
});
