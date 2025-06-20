mad.js

script that plays evolve
https://pmotschmann.github.io/Evolve/

currently only plays up to the first type of reset (MAD)

usage:
- do the protoplasm phase manually
- select challenge genes (optional)
- select race and begin
- press f12 to open javascript console (firefox, chrome)
- copy/paste the contents of mad.js to the console, press enter
- wait until the script researches mutually assured destruction, then
  perform the reset manually

system requirements:
- in the game, set debug mode on and preload tab content on
- no tampermonkey/greasemonkey needed (or supported)

progression requirements:
- governors unlocked (script doesn't assign crates)
- 25 steel from technophobe (script doesn't try to get steel)
- some metaprogression (no idea how much)

supports:
- servants and skilled servants

stuff that doesn't work:
- synth and nano races
- script doesn't care about most race-specific stuff (shrines, sacrificial
  altar, slaves, ocular powers, wish)
- script doesn't care about universe-specific stuff (authority, anything in
  magic)
- truepath mad

stuff that actually works:
- balorg

warning! use at your own risk. make a save first. the script is extremely
fragile and will break on the slighest change in the game code and html design.
i assume no responsibility if the script breaks and clicks out of bounds and
spends all your prestige resources on stupid stuff in arpa->genetics or buys
dark energy bomb or buys bad blood infusions or does a hard reset

just use volch's script instead
