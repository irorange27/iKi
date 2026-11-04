import type { SqliteDatabase } from '../sqlite';
import type { Migration } from './runner';

/**
 * One shape for the tool-execution journal.
 *
 * Older rows stored the tool result as a full wire object —
 * `result: {type, toolCallId, toolName, output}` — inside a fact that already
 * carried the call's identity in `binding` (or at the payload's top level). One
 * fact in two places forced every reader to check that the copies agreed before it
 * could use them, and recovery read its own "do not replay" decision back out of
 * the error text meant for the model.
 *
 * The current shape keeps the identity in the binding, puts the recorded value in
 * `output`, and states a refused replay as an `interruption` object. This migration
 * re-encodes history; it changes no facts.
 */
const INTERRUPTED_CODE = 'tool-execution-interrupted';

const relocateResultOutput = (db: SqliteDatabase, type: string): void => {
  // json_extract of a missing path is NULL, so a row that already carries `output`,
  // or never carried `result`, is left exactly as it is.
  db.prepare(
    `UPDATE session_events
        SET payload = json_set(json_remove(payload, '$.result'), '$.output',
                               json_extract(payload, '$.result.output'))
      WHERE type = ?
        AND json_extract(payload, '$.result') IS NOT NULL
        AND json_extract(payload, '$.output') IS NULL`
  ).run(type);
};

const migration: Migration = {
  name: '004_one_shape_per_execution_fact',
  up: (db: SqliteDatabase) => {
    relocateResultOutput(db, 'tool_execution_finished');
    relocateResultOutput(db, 'tool_executed');

    // A refused replay becomes a fact on the row instead of something the next
    // reader has to recognize by parsing the model-facing error value.
    db.exec(
      `UPDATE session_events
          SET payload = json_set(
              payload,
              '$.interruption',
              json_object(
                'storedReplay', json_extract(payload, '$.output.value.storedReplay'),
                'declaredReplay', json_extract(payload, '$.output.value.declaredReplay')
              )
            )
        WHERE type = 'tool_execution_finished'
          AND json_extract(payload, '$.output.value.code') = '${INTERRUPTED_CODE}'
          AND json_extract(payload, '$.interruption') IS NULL`
    );

    // The accepted input no longer carries a copy of the composed system prompt:
    // turn_prep owns that text and rebuilds it for the turn being started now.
    db.exec(
      `UPDATE session_events
          SET payload = json_remove(payload, '$.system')
        WHERE type = 'input_accepted'
          AND json_extract(payload, '$.system') IS NOT NULL`
    );
  },
};

export { migration };
