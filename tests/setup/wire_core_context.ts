// Inject a no-op user data path into the core logger so tests that don't
// specifically mock it can still run. Tests that DO mock the logger via
// vi.mock will override this (vi.mock hoisting replaces the entire module).

import { injectGetUserDataPath } from '@iki/backend/logger';

injectGetUserDataPath(() => '/tmp/iki-test-user-data');
