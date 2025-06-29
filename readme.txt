mad.js        script v1, does only mad reset
evolve.js     script v2, currently mad and bioseed

script that plays evolve
https://pmotschmann.github.io/Evolve/

script v1:
- mad reset should work for all races

script v2:
- mad reset should work for all races
- bioseed reset implemented
- black hole reset under development. i assume lumber+plywood is eliminated
  from all runs that go at least this far now

usage:
- do the protoplasm phase manually
- select challenge genes (optional)
- select race and begin
- press f12 to open javascript console (firefox, chrome)
- copy/paste the contents of evolve.js to the console
- comment out the desired reset type, press enter
- wait until the script reaches the reset point, then perform the reset manually
- playing manually while using the script is not recommended. holding the
  multiplier keys can multiply the script's actions and do unintended things

system requirements:
- in the game, set debug mode on and preload tab content on
- no tampermonkey/greasemonkey needed (or supported)
- a somewhat recent browser that supports the Set data structure in javascript
  (probably not older than 2024)

progression requirements:
- governors unlocked. only 1 task used so far (assign crates). mech constructor
  and mass ejector are going to be used when interstellar and spire are implemented
- 25 steel from technophobe (script doesn't try to get steel)
- some metaprogression (no idea how much). i haven't really tested on lower
  progression

supports:
- servants and skilled servants

stuff that's supported:
- balorg, uses combat to get titanium
- meditation chamber (capybara)
- smokehouse (carnivore races)
- slaves (balorg)
- rituals (magic universe)
- tax-morale balance, not using governor task
- synth and nano, but it's a rough run with power struggles and apartments
  often losing power causing homelessness, even with late-game progression
- does spy actions (influence, sabotage), aims to purchase foreign powers
- ravenous taken into account. not tested for synth and other races with
  pseudo-food
- matter replicator, not using governor task. as a side effect, replicator
  power use is deducted from top left MW left
- unicorn shrine. always builds 25 knowledge shrines, then metal only

stuff that's inefficient:
- script doesn't save steel for the first factory (which is important) and can
  buy a bunch of steel horseshoes first
- script buys gps satellites when we'd rather have spaceports, factories,
  iridium mines, mining outposts (i guess we do want a few gps satellites)
- for now script distributes each crafter equally among resources (at least in
  mad-land and bioseed-land), but optimizing this is extremely low priority
- the script insists on trying to be at positive power near the end of mad runs
  (with all industry buildings turned on), when it reset faster by increasing
  the knowledge cap (and let some rock quarriers and whatever be turned off).
  it gets worse if all resources are present and we have powered sawmills,
  quarries, cement plants, mines
- when playing synth or nano, the script sees wireless signal deficit and
  builds a bunch of transmitters that can't be powered on because of power
  deficit, and for some reason the script doesn't build mines to get copper for
  coal powerplants. though the script gets out of this rut after ~250 days

stuff that doesn't work:
- some race-specific stuff not yet implemented (sacrificial altar, ocular
  powers, wish)
- some universe-specific stuff (authority) not yet implemented
- truepath not tested. most stuff might work up to long-range probes
- probably some corner cases that can make the script trip up, like
  high population+horseshoes
- events in general
  - thermite gets assigned crafters like a normal resource. can cause problems
    early in the run with low aluminium production
- script struggles with blubber (oil production)

bugs:
- when spawning government change modal an additional empty modal might spawn
- empty espionage modal can spawn which must be dismissed manually
- in market and storage tabs there's sometimes garbage on the bottom
- script overbuilds on mars which isn't supposed to happen
- trading in MAD: sometimes sticks to titanium routes for too long and doesn't
  buy uranium
- sometimes normal servants arrive, but skilled servants don't. i don't know if
  the script is at fault. can be solved by refreshing the webpage and
  re-pasting the script
- script is softlocked when trying to buy freight yard and there are no
  crafters on wrought iron. happens very often when skilled servants don't
  arrive. should fix this, ideally script should work without skilled servants
- sometimes civic->government->mimic shows "none" despite the script having
  selected a mimic. this is a visual error, the chosen mimic is in effect
- the script doesn't stop if the game is paused, it should

warning! use at your own risk. make a save first. the script is extremely
fragile and will break on the slighest change in the game code and html design.
i assume no responsibility if the script breaks and clicks out of bounds and
spends all your prestige resources on stupid stuff in arpa->genetics or buys
dark energy bomb or buys bad blood infusions or does a hard reset. for whatever
it's worth, i'm using the script on my own main save, but i make backups often

just use volch's script instead
https://github.com/Vollch/Evolve-Automation

i looked a lot in volch's script to figure out how to interface with the game
