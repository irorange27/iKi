// Wire core context injection points with no-op defaults so that tests
// that don't specifically mock a context module can still run.
// Tests that DO mock a context module via vi.mock will override these
// defaults (vi.mock hoisting replaces the entire module).

import { injectGetUserDataPath } from '@iki/core/context/platform_provider';

injectGetUserDataPath(() => '/tmp/iki-test-user-data');
