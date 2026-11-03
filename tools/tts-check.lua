-- Consistency check for the engine renderer (engineSelfCheck): does the table show exactly what the engine says?
-- Run through the bridge debug channel (tools/tts-exec.sh).
return JSON.encode(engineSelfCheck())
