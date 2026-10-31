-- Removes only the cards and decks the automated tests spawned (GMNotes "testcard"), including decks of test cards
-- mixed with engine library placeholders ("libcard"). Never touches anything else.
local n = 0
for _, o in ipairs(getObjects()) do
  if tostring(o.getGMNotes()) == "testcard" then o.destruct() n = n + 1 end
  if o.type == "Deck" then
    local all = #o.getObjects() > 0
    -- test cards, plus the engine's library placeholders that got merged in with them (problem-log P8)
    for _, e in ipairs(o.getObjects()) do if e.gm_notes ~= "testcard" and e.gm_notes ~= "libcard" then all = false end end
    if all then o.destruct() n = n + 1 end
  end
end
return "removed " .. n .. " test objects"
