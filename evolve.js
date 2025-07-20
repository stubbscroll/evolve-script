// evolve-playing script v2

// how it works: it's heuristics-based (basically a list of rules) and tries to
// emulate my playstyle. we have to do the protoplasm stage manually and
// pick a race, then the rest of the run is automated except for the reset.
// there are no options to set. the script is supposed to play somewhat
// efficiently and avoid doing stupid stuff.

// beware of playing manually when the script is active. holding multiplier keys
// will make the script accidentally apply multipliers to actions it does. it's
// safest to disable multiplier keys in options

// can currently do: MAD, bioseed, vacuum collapses, lone survivor

//-----------------------------------------
// various general-purpose helper functions
//-----------------------------------------

// convert number string from the game to double. handles comma as thousand
// separator, handles metric suffixes, handles scientific/engineering notations
function str_to_float(q) {
	q=q.replace(/,/g,'');
	q=q.replace('K','e3').replace('M','e6').replace('G','e9').replace('T','e12').replace('P','e15').replace('E','e18').replace('Z','e21').replace('Y','e24');
	return parseFloat(q);
}

// given id tag, return float contained in innerhtml, or null if not found
function get_number_by_id(str) {
	let q=document.getElementById(str);
	if(q==null) return null;
	return str_to_float(q.innerHTML);
}

// capitalize first letter in underscored string
function str_capitalize(str) {
	let out=str[0].toUpperCase();
	for(let i=1;i<str.length;i++) {
		if(str[i-1]=='_') out+=str[i].toUpperCase();
		else out+=str[i];
	}
	return out;
}

// convert string of the type "5d 13h 5m 9s" to seconds
// input can be 'never' which is a special case
// used on time left variable from evolve.global.city.buildings
function convert_to_seconds(time) {
	if(time==null || time=='never') return NaN;
	let a=time.split(' ');
	let seconds=0;
	for(let v of a) {
		let value=parseInt(v);
		let unit=v[v.length-1];
		if(unit=='s') seconds+=value;
		else if(unit=='m') seconds+=value*60;
		else if(unit=='h') seconds+=value*3600;
		else if(unit=='d') seconds+=value*24*3600;
	}
	return seconds;
}

function getchildbyclassname(q,str) {
	for(let i=0;i<q.childNodes.length;i++) if(q.childNodes[i].className==str) {
		return q.childNodes[i];
	}
	return null;
}

// convert reskinned resource names to canonical names
function canonical_resource(res) {
	if(res=='Bones') return 'Lumber';
	else if(res=='Flesh') return 'Furs';
	else if(res=='Clay') return 'Stone';
	return res;
}

//----------------------------------
// global variables containing state
//----------------------------------

// these are the only states the script keeps
// i guess i could abuse the message log for state variables...
var global={
	change_government:'', // contains government to change to
	spy_action:'',        // which spy action to do ('sabotage','influence','incite','purchase')
	spy_id:-1,            // need spy id for the above
	bioseed_action:'',    // 'ship_and_probes': queue bioseeder ship and all probes,
	                      // 'prep_ship': prep ship (and queue more space probes)
};

//----------------------
// settings for all runs
//----------------------

var settings={
	gather_amount:50,
	crate_reserve:1000,         // crate construction reserve
	container_reserve:1000,     // container construction reserve
	slaver_buy_threshold:10000, // added to buy price
	spy_buy_threshold:100000,   // added to the spy cost
	spy_purchase_power_thresholds:[2500000,2000000,4500000],
	depopulate_farmer_threshold:5000, // depopulate farmers with food above this value. should be low because of ravenous
	replicator_power_buffer:5,
	peacekeeper_buffer:3,
	megaproject_amount:50,      // try to build up to this amount of mega projects
	spirit_vacuum_power_buffer:1000,
};

//----------------------------------------------------
// helper functions that access DOM and game variables
// a lot of these get called directly though
//----------------------------------------------------

/* about return values:
   thing_exists(), has_thing() functions return true or false
   get_thing() functions return the thing, or null (some exceptions exist)
*/

// TODO rewrite to use variables
// evolve.global.queue
// also, research queue in evolve.global.rqueue
function is_build_queue_empty() {
	let q=document.getElementById('buildQueue');
	if(q==null) return true; // that's true, nothing is queued if queue doesn't exist
	let str=q.firstChild?.innerHTML;
	if(str==undefined) return true;
	let pos=str.indexOf('(0/');
	return pos>=0;
}

// check if variable exists under evolve.global
// applicable for city, space, arpa
// also interstellar, andromeda, hell, edenic, dunno their id yet
function tab_exists(id) {
	return evolve.global.hasOwnProperty(id);
}

function resource_exists(resource) {
	if(!evolve.global.resource.hasOwnProperty(resource)) return false;
	return evolve.global.resource[resource].display?true:false;
}

function get_resource(resource) {
	if(!resource_exists(resource)) return null;
	return evolve.global.resource[resource];
}

// return production per second of a resource as a double, or NaN if not found
// to force it to always fail numerical comparisons.
// resource name (string) must start with an uppercase letter.
// TODO make sure returned value is after mass ejecting, hell transporting,
// rituals, trade routes etc
function get_production(resource) {
	if(!resource_exists(resource)) return NaN;
	return get_resource(resource).diff;
}

// return ratio of stockpile that decays per tick
function ravenous_percentage(rank) {
	if(rank<1) return .5;
	else if(rank==1) return 1./3;
	else return .25;
}

// return food production excluding decay from ravenous
// if we didn't care about this everyone would end up as farmers
function get_ravenous_food_production() {
	if(!resource_exists('Food')) return NaN;
	if(!has_trait('ravenous')) return get_resource('Food').diff;
	let food=get_resource('Food').diff;
	food+=get_resource('Food').amount*ravenous_percentage(evolve.global.race.ravenous);
	return food;
2}

// return rank if current race has trait, otherwise return null
function get_trait_level(trait) {
	if(!evolve.global.race.hasOwnProperty(trait)) return null;
	return evolve.global.race[trait];
}

// check if trait exists
function has_trait(trait) {
	return get_trait_level(trait)!=null;
}

function return_pop_modifier() {
	let h=get_trait_level('high_pop');
	if(h==null) return 1;
	else if(h<=0.25) return 2;
	else if(h==0.5) return 3;
	else return h+3;
}

// checks tech and tech-level. the wiki doesn't have the internal names,
// so look in the source code or something
function has_tech(tech,techlevel=-1) {
	if(techlevel<0) console.log('has_tech error, second parameter missing');
	if(!evolve.global.tech.hasOwnProperty(tech)) return false;
	return evolve.global.tech[tech]>=techlevel;
}

function has_exact_tech(tech,techlevel=-1) {
	if(techlevel<0) console.log('has_tech error, second parameter missing');
	if(!evolve.global.tech.hasOwnProperty(tech)) return false;
	return evolve.global.tech[tech]==techlevel;
}

function building_exists(where,what=null) {
	if(what==null) console.log('ERROR, building_exists needs 2 parameters, got:',where);
	if(!tab_exists(where)) return false;
	return evolve.global[where].hasOwnProperty(what);
}

function get_building(where,what) {
	if(!building_exists(where,what)) return null;
	return evolve.global[where][what];
}

function get_building_count(where,what) {
	let b=get_building(where,what);
	if(b==null) return 0;
	return b.count;
}

// get time left to building given building
function production_time_left(where,what) {
	if(!building_exists(where,what)) return null;
	return convert_to_seconds(evolve.global[where][what].time);
}

// get current population
function get_population() {
	return evolve.global.resource[evolve.global.race.species].amount;
}

function get_max_population() {
	return evolve.global.resource[evolve.global.race.species].max;
}

// return the number of crafting resources
function num_crafting_materials() {
	let num=0;
	for(let mat in evolve.craftCost) if(evolve.global.resource[mat]?.display) num++;
	return num;
}

// return the race's genus as an array (can be two)
function get_genera() {
	// don't know how to find both genera of hybrid races, stupid solution for now
	if(evolve.global.race.species=='hybrid') return [evolve.global.race.maintype,evolve.global.custom.race1.hybrid[1]];
	else if(evolve.global.race.species=='dwarf') return ['humanoid','small'];
	else if(evolve.global.race.species=='raccon') return ['carnivore','herbivore'];
	else if(evolve.global.race.species=='lichen') return ['plant','fungi'];
	else if(evolve.global.race.species=='wyvern') return ['avian','reptilian'];
	else if(evolve.global.race.species=='beholder') return ['eldritch','giant'];
	else if(evolve.global.race.species=='djinn') return ['sand','fey'];
	else if(evolve.global.race.species=='narwhal') return ['aquatic','polar'];
	else if(evolve.global.race.species=='bombardier') return ['insectoid','heat'];
	else if(evolve.global.race.species=='nephilim') return ['demonic','angelic'];
	else return [evolve.global.race.maintype];
}

function get_mimic() {
	return evolve.global.race?.ss_genus;
}

// don't rely on classname="action vb", actually check if we have the resources.
// return true if we can afford, false otherwise
// newest version. we lose scalar
// didn't work: use DOM to extract costs (they were sometimes outdated)
// didn't work: evolve.actions.where.what.cost, sometimes returned non-existing
//              resources (lumber when we have heat genus)
function can_afford_thing(where,what,where2=null) {
	if(where2) return evolve.checkAffordable(evolve.actions[where][where2][what],false,false);
	return evolve.checkAffordable(evolve.actions[where][what],false,false);
}

// return true if we have enough caps to theoretically afford
function can_afford_at_max(where,what,where2=null) {
	if(where2) return evolve.checkAffordable(evolve.actions[where][where2][what],true,false);
	return evolve.checkAffordable(evolve.actions[where][what],true,false);
}

// research a tech that's not in the avoidlist
// have to vue-click in here, no click caller in global variable
// return true if we clicked
function research_tech(avoidlist) {
	// can either get id with the short, generic-ish name 'tech', or get id
	// with the name 'mTabResearch' and do a hideous access 3 layers deep
	let q=document.getElementById('tech');
	if(q==null) return false;
	for(let i=0;i<q.childNodes.length;i++) if(q.childNodes[i].id.substring(0,5)=='tech-') {
		let techname=q.childNodes[i].id.slice(5);
		if(avoidlist.has(techname)) continue;
		// check if tech is affordable
		if(!can_afford_thing('tech',techname)) continue;
		// can't buy precognition tech
		if(q.childNodes[i].firstChild.className.includes('precog')) continue;
		q.childNodes[i].__vue__.action();
		return true;
	}
	return false;
}

// research only techs from given list
function research_given_techs(list) {
	let q=document.getElementById('tech');
	if(q==null) return false;
	for(let i=0;i<q.childNodes.length;i++) if(q.childNodes[i].id.substring(0,5)=='tech-') {
		let techname=q.childNodes[i].id.slice(5);
		if(!list.has(techname)) continue;
		// check if tech is affordable
		if(!can_afford_thing('tech',techname)) continue;
		// can't buy precognition tech
		if(q.childNodes[i].firstChild.className.includes('precog')) continue;
		q.childNodes[i].__vue__.action();
		return true;
	}
	return false;
}

// appoint a governor. requires that none is currently set
function set_governor(governor) {
	if(!has_tech('governor',1)) return false;
	let cand=evolve.global.race.governor?.candidates;
	if(cand) {
		for(let i=0;i<cand.length;i++) if(cand[i].bg==governor) {
			document.getElementById('candidates').__vue__.appoint(i);
			return true;
		}
	}
	return false;
}

// needs vue i guess
// TODO rewrite this function to be similar to factory and trading
function set_smelter_output(iron,steel,iridium) {
	let smelter=get_building('city','smelter');
	if(smelter!=null) {
		let oldiron=smelter.Iron;
		let oldsteel=smelter.Steel;
		let oldiridium=smelter.Iridium;
		let q=document.getElementById('iSmelter');
		if(q==null) return;
		q=q.__vue__;
		while(oldiron>iron) q.subMetal('Iron'),oldiron--;
		while(oldsteel>steel) q.subMetal('Steel'),oldsteel--;
		while(oldiridium>iridium) q.subMetal('Iridium'),oldiridium--;
		while(oldiron<iron) q.addMetal('Iron'),oldiron++;
		while(oldsteel<steel) q.addMetal('Steel'),oldsteel++;
		while(oldiridium<iridium) q.addMetal('Iridium'),oldiridium++;
	}
}

// set a single resource to amount
// TODO rewrite this function to be similar to factory and trading
function set_nanite_input(resource,amount) {
	let q=document.getElementById('iNFactory');
	if(q!=null) {
		q=q.__vue__;
		let res=evolve.global.city.nanite_factory[resource];
		if(res!=null) {
			while(res<amount) q.addItem(resource),res++;
			while(res>amount) q.subItem(resource),res--;
		}
	}
}

// return factory capacity
// TODO add other factories (mega factory missing)
// TODO high-tech factories: account for ls/retirement increase
function get_num_factory_production_lines() {
	let num=0;
	if(building_exists('city','factory')) num+=evolve.global.city.factory.count;
	if(building_exists('space','red_factory')) num+=evolve.global.space.red_factory.count;
	if(building_exists('interstellar','int_factory')) num+=evolve.global.interstellar.int_factory.count*2;
	// tau ceti factories have 3 lines in truepath, 5 lines in lone survivor
	if(building_exists('tauceti','tau_factory')) num+=evolve.global.tauceti.tau_factory.count*5;
	if(building_exists('portal','hell_factory')) {
		let lines=3+evolve.global.portal.hell_factory.rank;
		num+=evolve.global.portal.hell_factory.count*lines;
	}
	return num;
}

// set factory production
// input is a list where each item takes 2 slots:
// [resource1, amount1, resource2, amount2 etc]
// resources not given are set to 0
// warning: the vue interface lets us set production to elements not discovered,
// and it's impossible to change that back in the game's ui until we discover
// said element
function set_factory_production(list) {
	if(!Array.isArray(list)) { console.log('set_factory_production: expected list'); return; }
	let ids=['Lux','Furs','Alloy','Polymer','Nano','Stanene'];
	let res=['Money','Furs','Alloy','Polymer','Nano_Tube','Stanene'];
	let current=[0,0,0,0,0,0];
	let desired=[0,0,0,0,0,0];
	let q=document.getElementById('iFactory');
	if(q==null) { console.log('error, factory not found'); return; }
	// get current settings
	for(let i=0;i<6;i++) {
		current[i]=evolve.global.city.factory[ids[i]];
		if(current[i]>0 && !resource_exists(res[i])) {
			console.log('sanity error, factory set to',res[i],'which doesn\'t exist. fixing now');
			while(current[i]>0) q.__vue__.subItem(ids[i]),current[i]--;
		}
	}
	let num=list.length;
	for(let i=0;i<num;i+=2) {
		let j=ids.indexOf(list[i]);
		if(!resource_exists(res[j])) { console.log('factory error, trying to produce non-existing element',res[j]); return; }
		if(j<0) { console.log('invalid factory id',list[i]); return; }
		desired[j]=list[i+1];
	}
	// vue add/sub doesn't take amount
	// first pass: decrease
	for(let i=0;i<6;i++) while(current[i]>desired[i]) q.__vue__.subItem(ids[i]),current[i]--;
	// second pass: increase
	for(let i=0;i<6;i++) while(current[i]<desired[i]) q.__vue__.addItem(ids[i]),current[i]++;
}

// TODO bug, this doesn't assign one line
function set_factory_production_percent(list) {
	let n=get_num_factory_production_lines();
	let cur=0;
	for(let i=1;i<list.length;i+=2) {
		list[i]=Math.trunc(list[i]*n/100.0);
		cur+=list[i];
	}
	// distribute leftovers
	for(let i=1;cur<n;cur++) {
		list[i]++; cur++;
		i+=2;
		if(i>=list.length) i=1;
	}
	set_factory_production(list);
}

// assign factory production. takes in a list with resources and percentages
// remove resources that are capped
function set_factory_production_percent_check_cap(list) {
	let ids=['Lux','Furs','Alloy','Polymer','Nano','Stanene'];
	let resname=['Money','Furs','Alloy','Polymer','Nano_Tube','Stanene'];
	let list2=[];
	let j=0;
	for(let i=0;i<list.length;i+=2) {
		let res='';
		for(let k=0;k<6;k++) if(ids[k]==list[i]) {
			res=resname[k];
			break;
		}
		if(!resource_exists(res)) continue;
		let r=get_resource(res);
		// just take max*0.995 or something which handles stuff like upkeep
		if(r.amount>=r.max*0.995) continue;
		list2[j++]=list[i]; list2[j++]=list[i+1];
	}
	// everything is capped, stop factories
	if(list2.length==0) return set_factory_production(['Lux',0,'Furs',0,'Alloy',0,'Polymer',0,'Nano',0,'Stanene',0]);
	// normalise list up to 100%
	let sum=0;
	for(let i=0;i<list2.length;i+=2) sum+=list2[i+1];
	if(sum==0) return; // we asked for 0%
	for(let i=0;i<list2.length;i+=2) list2[i+1]=list2[i+1]*100/sum;
	set_factory_production_percent(list2);
}

function get_factory_production(res) {
	let q=document.getElementById('iFactory');
	if(res=='Lux') return q.__vue__.Lux;
	else if(res=='Furs') return q.__vue__.Furs;
	else if(res=='Alloy') return q.__vue__.Alloy;
	else if(res=='Polymer') return q.__vue__.Polymer;
	else if(res=='Nano') return q.__vue__.Nano;
	else if(res=='Stanene') return q.__vue__.Stanene;
	else return null;
}

function set_mining_droid_production(list) {
	if(!Array.isArray(list)) { console.log('set_mining_droid_production: expected list'); return; }
	let ids=['adam','uran','coal','alum'];
	let res=['Adamantite','Uranium','Coal','Aluminium'];
	let current=[0,0,0,0];
	let desired=[0,0,0,0];
	let q=document.getElementById('iDroid');
	if(q==null) { console.log('error, factory not found'); return; }
	// get current settings
	for(let i=0;i<4;i++) {
		current[i]=evolve.global.interstellar.mining_droid[ids[i]];
		if(current[i]>0 && !resource_exists(res[i])) {
			console.log('sanity error, mining_droid set to',res[i],'which doesn\'t exist. fixing now');
			while(current[i]>0) q.__vue__.subItem(ids[i]),current[i]--;
		}
	}
	let num=list.length;
	for(let i=0;i<num;i+=2) {
		let j=ids.indexOf(list[i]);
		if(!resource_exists(res[j])) { console.log('mining droid error, trying to produce non-existing element',list[i]); return; }
		if(j<0) { console.log('invalid factory id',list[i]); return; }
		desired[j]=list[i+1];
	}
	// vue add/sub doesn't take amount
	// first pass: decrease
	for(let i=0;i<4;i++) while(current[i]>desired[i]) q.__vue__.subItem(ids[i]),current[i]--;
	// second pass: increase
	for(let i=0;i<4;i++) while(current[i]<desired[i]) q.__vue__.addItem(ids[i]),current[i]++;

}

// list of all structures with sublocations
const sublocation=new Map([
// space - home
	['space-test_launch','spc_home'],
	['space-satellite','spc_home'],
	['space-gps','spc_home'],
	['space-propellant_depot','spc_home'],
	['space-nav_beacon','spc_home'],
// space - moon
	['space-moon_mission','spc_moon'],
	['space-moon_base','spc_moon'],
	['space-iridium_mine','spc_moon'],
	['space-helium_mine','spc_moon'],
	['space-observatory','spc_moon'],
// space - red planet (mars)
	['space-red_mission','spc_red'],
	['space-spaceport','spc_red'],
	['space-red_tower','spc_red'],
	['space-living_quarters','spc_red'],
	['space-garage','spc_red'],
	['space-red_mine','spc_red'],
	['space-fabrication','spc_red'],
	['space-red_factory','spc_red'],
	['space-biodome','spc_red'],
	['space-ziggurat','spc_red'],
	['space-space_barracks','spc_red'],
	['space-exotic_lab','spc_red'],
// space - hell planet (mercury)
	['space-hell_mission','spc_hell'],
	['space-geothermal','spc_hell'],
	['space-spc_casino','spc_hell'],
	['space-swarm_plant','spc_hell'],
// space - sun
	['space-sun_mission','spc_sun'],
	['space-swarm_control','spc_sun'],
	['space-swarm_satellite','spc_sun'],
// space - gas planet (jupiter)
	['space-gas_mission','spc_gas'],
	['space-gas_mining','spc_gas'],
	['space-gas_storage','spc_gas'],
	['space-star_dock','spc_gas'],
// space - gas moon (ganymede)
	['space-gas_moon_mission','spc_gas_moon'],
	['space-outpost','spc_gas_moon'],
	['space-oil_extractor','spc_gas_moon'],
// space - asteroid belt
	['space-belt_mission','spc_belt'],
	['space-space_station','spc_belt'],
	['space-elerium_ship','spc_belt'],
	['space-iridium_ship','spc_belt'],
	['space-iron_ship','spc_belt'],
// space - dwarf planet (ceres)
	['space-dwarf_mission','spc_dwarf'],
	['space-e_reactor','spc_dwarf'],
	['space-world_collider','spc_dwarf'],
// interstellar - alpha centauri
	['interstellar-alpha_mission','int_alpha'],
	['interstellar-starport','int_alpha'],
	['interstellar-habitat','int_alpha'],
	['interstellar-mining_droid','int_alpha'],
	['interstellar-processing','int_alpha'],
	['interstellar-fusion','int_alpha'],
	['interstellar-laboratory','int_alpha'],
	['interstellar-exchange','int_alpha'],
	['interstellar-g_factory','int_alpha'],
	['interstellar-int_factory','int_alpha'],
	['interstellar-luxury_condo','int_alpha'],
	['interstellar-zoo','int_alpha'],
	['interstellar-warehouse','int_alpha'],
// interstellar - proxima centauri
	['interstellar-proxima_mission','int_proxima'],
	['interstellar-xfer_station','int_proxima'],
	['interstellar-cargo_yard','int_proxima'],
	['interstellar-cruiser','int_proxima'],
	['interstellar-dyson','int_proxima'],
// interstellar - helix nebula
	['interstellar-nebula_mission','int_nebula'],
	['interstellar-harvester','int_nebula'],
	['interstellar-elerium_prospector','int_nebula'],
	['interstellar-nexus','int_nebula'],
// interstellar - neutron
	['interstellar-neutron_mission','int_neutron'],
	['interstellar-neutron_miner','int_neutron'],
	['interstellar-citadel','int_neutron'],
	['interstellar-stellar_forge','int_neutron'],
// interstellar - blackhole
	['interstellar-blackhole_mission','int_blackhole'],
	['interstellar-far_reach','int_blackhole'],
	['interstellar-stellar_engine','int_blackhole'],
	['interstellar-mass_ejector','int_blackhole'],
	['interstellar-jump_ship','int_blackhole'],
	['interstellar-wormhole_mission','int_blackhole'],
//	['interstellar-stargate','int_blackhole'],
	['interstellar-s_gate','int_blackhole'],
// interstellar - sirius
	['interstellar-sirius_mission','int_sirius'],
	['interstellar-space_elevator','int_sirius'],
	['interstellar-thermal_collector','int_sirius'],
	['interstellar-gravity_dome','int_sirius'],
	['interstellar-ascension_machine','int_sirius'],
	['interstellar-ascension_trigger','int_sirius'],
	['interstellar-ascend','int_sirius'],
	['interstellar-sirius_b','int_sirius'],

// andromeda - gateway
	['galaxy-gateway_mission','gxy_gateway'],
	['galaxy-starbase','gxy_gateway'],
	['galaxy-ship_dock','gxy_gateway'],
	['galaxy-bolognium_ship','gxy_gateway'],
	['galaxy-scout_ship','gxy_gateway'],
	['galaxy-corvette_ship','gxy_gateway'],
	['galaxy-frigate_ship','gxy_gateway'],
	['galaxy-cruiser_ship','gxy_gateway'],
	['galaxy-dreadnought','gxy_gateway'],
// andromeda - stargate
	['galaxy-gateway_station','gxy_stargate'],
	['galaxy-telemetry_beacon','gxy_stargate'],
	['galaxy-gateway_depot','gxy_stargate'],
	['galaxy-defense_platform','gxy_stargate'],
// andromeda - gorddon
	['galaxy-gorddon_mission','gxy_gorddon'],
	['galaxy-embassy','gxy_gorddon'],
	['galaxy-dormitory','gxy_gorddon'],
	['galaxy-symposium','gxy_gorddon'],
	['galaxy-freighter','gxy_gorddon'],
// andromeda - alien1
	['galaxy-consulate','gxy_alien1'],
	['galaxy-resort','gxy_alien1'],
	['galaxy-vitreloy_plant','gxy_alien1'],
	['galaxy-super_freighter','gxy_alien1'],
// andromeda - alien2
	['galaxy-alien2_mission','gxy_alien2'],
	['galaxy-foothold','gxy_alien2'],
	['galaxy-armed_miner','gxy_alien2'],
	['galaxy-ore_processor','gxy_alien2'],
	['galaxy-scavenger','gxy_alien2'],
// andromeda - chthonian
	['galaxy-chthonian_mission','gxy_chthonian'],
	['galaxy-minelayer','gxy_chthonian'],
	['galaxy-excavator','gxy_chthonian'],
	['galaxy-raider','gxy_chthonian'],

// portal - fortress
	['portal-turret','prtl_fortress'],
	['portal-carport','prtl_fortress'],
	['portal-war_droid','prtl_fortress'],
	['portal-repair_droid','prtl_fortress'],
// portal - badlands
	['portal-war_drone','prtl_badlands'],
	['portal-sensor_drone','prtl_badlands'],
	['portal-attractor','prtl_badlands'],
// portal - the pit
	['portal-pit_mission','prtl_pit'],
	['portal-assault_forge','prtl_pit'],
	['portal-soul_forge','prtl_pit'],
	['portal-gun_emplacement','prtl_pit'],
	['portal-soul_attractor','prtl_pit'],
// portal - ancient ruins
	['portal-ruins_mission','prtl_ruins'],
	['portal-guard_post','prtl_ruins'],
	['portal-vault','prtl_ruins'],
	['portal-archaeology','prtl_ruins'],
	['portal-arcology','prtl_ruins'],
	['portal-hell_forge','prtl_ruins'],
	['portal-inferno_power','prtl_ruins'],
	['portal-ancient_pillars','prtl_ruins'],
// portal - ancient gate
	['portal-gate_mission','prtl_gate'],
	['portal-west_tower','prtl_gate'],
	['portal-east_tower','prtl_gate'],
	['portal-gate_turret','prtl_gate'],
	['portal-infernite_mine','prtl_gate'],
// portal - boiling lake of blood
	['portal-lake_mission','prtl_lake'],
	['portal-harbor','prtl_lake'],
	['portal-cooling_tower','prtl_lake'],
	['portal-bireme','prtl_lake'],
	['portal-transport','prtl_lake'],
// portal - the spire
	['portal-spire_mission','prtl_spire'],
	['portal-spire_survey','prtl_spire'],
	['portal-purifier','prtl_spire'],
	['portal-port','prtl_spire'],
	['portal-base_camp','prtl_spire'],
	['portal-bridge','prtl_spire'],
	['portal-mechbay','prtl_spire'],
	['portal-waygate','prtl_spire'],
	['portal-edenic_gate','prtl_spire'],

// eden - asphodel
	['eden-survery_meadows','eden_asphodel'],
	['eden-encampment','eden_asphodel'],
	['eden-soul_engine','eden_asphodel'],
	['eden-mech_station','eden_asphodel'],
	['eden-asphodel_harvester','eden_asphodel'],
	['eden-ectoplasm_processor','eden_asphodel'], // muon processor
	['eden-research_station','eden_asphodel'],    // magistrarium
	['eden-warehouse','eden_asphodel'],
	['eden-stabilizer','eden_asphodel'],
	['eden-rune_gate','eden_asphodel'],
	['eden-rune_gate_open','eden_asphodel'],
	['eden-bunker','eden_asphodel'],
	['eden-bliss_den','eden_asphodel'],
	['eden-corruptor','eden_asphodel'],

	['eden-rectory','eden_asphodel'],

// eden - elysium
	['eden-survey_fields','eden_elysium'],
	['eden-fortress','eden_elysium'],
	['eden-siege_fortress','eden_elysium'],
	['eden-raid_supplies','eden_elysium'],
	['eden-ambush_patrol','eden_elysium'],
	['eden-scout_elysium','eden_elysium'],
	['eden-fire_support_base','eden_elysium'],
	['eden-elysanite_mine','eden_elysium'],
	['eden-sacred_smelter','eden_elysium'],
	['eden-pillbox','eden_elysium'],

	['eden-archive','eden_elysium'],
	['eden-eden_cement','eden_elysium'],
	['eden-elerium_containment','eden_elysium'],
	['eden-eternal_bank','eden_elysium'],
	['eden-north_pier','eden_elysium'],
	['eden-reincarnation','eden_elysium'],
	['eden-restaurant','eden_elysium'],
	['eden-rushmore','eden_elysium'],

// eden - isle

	['eden-south_pier','eden_isle'],
	['eden-east_tower','eden_isle'],
	['eden-isle_garrison','eden_isle'],
	['eden-soul_compactor','eden_isle'],
	['eden-spirit_battery','eden_isle'],
	['eden-spirit_vacuum','eden_isle'],
	['eden-west_tower','eden_isle'],

// eden - palace

	['eden-scout_palace','eden_palace'],
	['eden-tomb','eden_palace'],
	['eden-apotheosis','eden_palace'],
	['eden-conduit','eden_palace'],
	['eden-infuser','eden_palace'],
	['eden-throne','eden_palace'],

// tauceti - star
	['tauceti-ringworld','tau_star'],
	['tauceti-matrix','tau_star'],
	['tauceti-goe_facility','tau_star'],
// tauceti - new earth
	['tauceti-orbital_station','tau_home'],
	['tauceti-colony','tau_home'],
	['tauceti-assembly','tau_home'],
	['tauceti-tau_farm','tau_home'],
	['tauceti-mining_pit','tau_home'],
	['tauceti-alien_outpost','tau_home'],
	['tauceti-fusion_generator','tau_home'],
	['tauceti-repository','tau_home'],
	['tauceti-tau_factory','tau_home'],
	['tauceti-infectious_disease_lab','tau_home'],
	['tauceti-tauceti_casino','tau_home'],
	['tauceti-tau_cultural_center','tau_home'],
// tauceti - new mars (womlings)
	['tauceti-red_mission','tau_red'],
	['tauceti-orbital_platform','tau_red'],
	['tauceti-subjugate','tau_red'],
	['tauceti-introduce','tau_red'],
	['tauceti-contact','tau_red'],
	['tauceti-overseer','tau_red'],
	['tauceti-womling_village','tau_red'],
	['tauceti-womling_farm','tau_red'],
	['tauceti-womling_mine','tau_red'],
	['tauceti-womling_fun','tau_red'],
	['tauceti-womling_lab','tau_red'],
// tauceti - gas giant
	['tauceti-gas_contest','tau_gas'],
	['tauceti-gas_contest-a1','tau_gas'],
	['tauceti-gas_contest-a2','tau_gas'],
	['tauceti-gas_contest-a3','tau_gas'],
	['tauceti-gas_contest-a4','tau_gas'],
	['tauceti-gas_contest-a5','tau_gas'],
	['tauceti-gas_contest-a6','tau_gas'],
	['tauceti-gas_contest-a7','tau_gas'],
	['tauceti-gas_contest-a8','tau_gas'],
	['tauceti-ore_refinery','tau_gas'],
	['tauceti-refueling_station','tau_gas'],
	['tauceti-whaling_station','tau_gas'],
	['tauceti-womling_station','tau_gas'],
// tauceti - tau ceti asteroid belt
	['tauceti-roid_mission','tau_roid'],
	['tauceti-mining_ship','tau_roid'],
	['tauceti-patrol_ship','tau_roid'],
	['tauceti-shaling_ship','tau_roid'],
// tauceti - gas giant 2
	['tauceti-gas_contest2','tau_gas2'],
	['tauceti-gas_contest-b1','tau_gas2'],
	['tauceti-gas_contest-b2','tau_gas2'],
	['tauceti-gas_contest-b3','tau_gas2'],
	['tauceti-gas_contest-b4','tau_gas2'],
	['tauceti-gas_contest-b5','tau_gas2'],
	['tauceti-gas_contest-b6','tau_gas2'],
	['tauceti-gas_contest-b7','tau_gas2'],
	['tauceti-gas_contest-b8','tau_gas2'],
	['tauceti-alien_station_survey','tau_gas2'],
	['tauceti-alien_space_station','tau_gas2'],
	['tauceti-alien_station','tau_gas2'],
	['tauceti-ignite_gas_giant','tau_gas2'],
	['tauceti-ignition_device','tau_gas2'],
	['tauceti-matrioshka_brain','tau_gas2'],
// stuff specific for warlord
// portal - badlands
	['portal-minions','prtl_badlands'],
	['portal-reaper','prtl_badlands'],
	['portal-codex','prtl_badlands'],

	['portal-corpse_pile','prtl_badlands'],
	['portal-mortuary','prtl_badlands'],
// portal - wasteland
	['portal-incinerator','prtl_wasteland'],
	['portal-warehouse','prtl_wasteland'],
	['portal-hovel','prtl_wasteland'],
	['portal-hell_casino','prtl_wasteland'],
	['portal-twisted_lab','prtl_wasteland'],
	['portal-demon_forge','prtl_wasteland'],
	['portal-hell_factory','prtl_wasteland'],
	['portal-pumpjack','prtl_wasteland'],
	['portal-dig_demon','prtl_wasteland'],
	['portal-tunneler','prtl_wasteland'],
	['portal-brute','prtl_wasteland'],
	['portal-s_alter','prtl_wasteland'],
	['portal-meditation','prtl_wasteland'],
	['portal-shrine','prtl_wasteland'],
// portal - the pit
	['portal-shadow_mine','prtl_pit'],
	['portal-tavern','prtl_pit'],

	['portal-absorption_chamber','prtl_pit'],
	['portal-soul_capacitor','prtl_pit'],
// portal - ancient ruins
	['portal-war_vault','prtl_ruins'],

// portal - boiling lake of blood

// portal - the spire
	['portal-bazaar','prtl_spire'],

]);

// build a building. return true if we succeeded
// changed to vue-click, evolve.actions-click didn't update ui
function build_structure(list) {
	// special cases: stuff not in evolve.global.location.building
	// missions are typically here
	let special_cases=['city-slave_market','city-assembly','space-test_launch',
		'space-moon_mission','space-red_mission','space-hell_mission','space-sun_mission',
		'space-gas_mission','space-gas_moon_mission','space-belt_mission',
		'space-dwarf_mission','city-horseshoe','interstellar-alpha_mission',
		'interstellar-proxima_mission','interstellar-nebula_mission',
		'interstellar-neutron_mission','interstellar-blackhole_mission','tauceti-contact',
		'tauceti-introduce','tauceti-subjugate','tauceti-gas_contest',
		'tauceti-roid_mission','tauceti-gas_contest2','tauceti-alien_station_survey',
		'portal-edenic_gate','eden-survery_meadows','eden-survey_fields',
		'eden-scout_elysium','eden-scout_palace','tauceti-assembly',
		'interstellar-jump_ship','interstellar-wormhole_mission','galaxy-gateway_mission',
		'portal-pit_mission','portal-assault_forge','galaxy-gorddon_mission',
		'galaxy-alien2_mission','galaxy-chthonian_mission','interstellar-sirius_mission',
		'interstellar-sirius_b','portal-ruins_mission','portal-gate_mission','portal-ancient_pillars',
		'tauceti-gas_contest-a1','tauceti-gas_contest-a2','tauceti-gas_contest-a3','tauceti-gas_contest-a4','tauceti-gas_contest-a5','tauceti-gas_contest-a6','tauceti-gas_contest-a7','tauceti-gas_contest-a8',
		'tauceti-gas_contest-b1','tauceti-gas_contest-b2','tauceti-gas_contest-b3','tauceti-gas_contest-b4','tauceti-gas_contest-b5','tauceti-gas_contest-b6','tauceti-gas_contest-b7','tauceti-gas_contest-b8'];
	if(!Array.isArray(list)) { console.log('build_structure: expected list, got',list); return false; } // must be an array of buildings
	for(let id of list) {
		let minus=id.indexOf('-');
		if(minus==-1) console.log('build structure: error, no minus in',id);
		let where=id.substring(0,minus);
		let what=id.slice(minus+1);
		let where2=sublocation.get(id);
		if(!tab_exists(where)) continue;
		// special cases that don't exist in evolve.global
		if(special_cases.includes(id) || evolve.global[where][what]!=null) {
			if(can_afford_thing(where,what,where2)) {
				let q=document.getElementById(id);
				// q can actually be 0 here. somehow city-rock_quarry with synth
				// imitating ent gets past the previous test
				if(!q) continue;
				// TODO action actually takes a parameter. didn't increase clicks
				q.__vue__.action();
				return true;
			}
		}
	}
	return false;
}

// return list of length 2n [res1,cost1,res2,cost2,...]
// grabbed from the html which kind of sucks
function get_building_cost(id) {
	let q=document.getElementById(id);
	if(!q) return false;
	let r=q.firstChild;
	let s=r.getAttributeNames();
	let cost=[];
	for(let str of s) if(str.substring(0,5)=='data-') {
		cost.push(str_capitalize(str.slice(5)));
		// TODO convert resource to canonical
		cost.push(parseInt(r.getAttribute(str)));
	}
	return cost;
}

function get_resource_cost_from_list(cost,res) {
	for(let i=0;i<cost.length;i+=2) if(cost[i]==res) return cost[i+1];
	return null;
}

// build a megaproject, and as many chunks as we can afford
// return true if succeeded
// max must contain the number of segments
function build_big_structure(id,max=-1) {
	if(max==-1) console.log('error build_big_structure',id+', max not given');
	let minus=id.indexOf('-');
	if(minus==-1) console.log('build big structure: error, no minus in',id);
	let where=id.substring(0,minus);
	let what=id.slice(minus+1);
	if(!tab_exists(where)) return false;
	if(evolve.global[where][what]!=null) {
		let cost=get_building_cost(id);
		if(cost==false) return false;
		// find amount we can buy
		let low=max-evolve.global[where][what].count;
		for(let i=0;i<cost.length;i+=2) {
			let res=cost[i],val=cost[i+1];
			if(resource_exists(res)) {
				let how=Math.trunc(get_resource(res).amount/val);
				if(low>how) low=how;
			} else return false;
		}
		if(low==0) return false;
		let q=document.getElementById(id);
		if(q==null) return false;
		if(low>settings.megaproject_amount) low=settings.megaproject_amount;
		for(let i=0;i<low;i++) q.__vue__.action();
	}
	return false;
}

// build up to max one of a building
function build_one(list) {
	if(!Array.isArray(list)) { console.log('build_one: expected list'); return false; } // must be an array of buildings
	for(let id of list) {
		let minus=id.indexOf('-');
		if(minus==-1) console.log('build one: error, no minus in',id);
		let where=id.substring(0,minus);
		let what=id.slice(minus+1);
		if(get_building_count(where,what)<1 && build_structure([id])) return true;
	}
	return false;
}

// given a list of desired buildings, check if we have them in the listed amount
// list: [location,building1,amount1,building2,amount2,...]
// all must in the same location from element 0
function we_have_buildings(list) {
	let loc=evolve.global[list[0]];
	for(let i=1;i<list.length;i+=2) {
		if(!loc.hasOwnProperty(list[i])) return false; // building doesn't exist
		if(loc[list[i]].count<list[i+1]) return false; // we don't have enough of building
	}
	return true;
}

function build_desired_buildings(list) {
	let loc=evolve.global[list[0]];
	for(let i=1;i<list.length;i+=2) {
		if(!loc.hasOwnProperty(list[i])) return false; // building doesn't exist
		if(loc[list[i]].count<list[i+1] && build_structure([list[0]+'-'+list[i]])) return true;
	}
	return false;
}

// return the number of buildings of given type
function num_structures(id) {
	let minus=id.indexOf('-');
	if(minus==-1) console.log(id,'probably error, called num_structure without minus with');
	let where=id.substring(0,minus);
	let what=id.slice(minus+1);
	if(!evolve.global.hasOwnProperty(where)) return null;
	if(!evolve.global[where].hasOwnProperty(what)) return null;
	return evolve.global[where][what].count;
}

// get enabled/disabled status for building
function get_enabled_disabled(id) {
	let q=document.getElementById(id);
	if(q==null) return null;
	let on,off;
	let str=q.__vue__.on_label();
	let pos=str.indexOf(': ');
	on=parseInt(str.slice(pos+2));
	str=q.__vue__.off_label();
	pos=str.indexOf(': ');
	off=parseInt(str.slice(pos+2));
	return [on,off];
}

function disable_building(id) {
	let q=document.getElementById(id);
	if(q==null) return null;
	q.__vue__.power_off();
	return true;
}

function enable_building(id) {
	let q=document.getElementById(id);
	if(q==null) return null;
	q.__vue__.power_on();
	return true;
}

function fully_enable_building(id) {
	let q=document.getElementById(id);
	if(q==null) return false;
	let onoff=get_enabled_disabled(id);
	if(onoff==null) return false;
	for(let i=0;i<onoff[1];i++) q.__vue__.power_on();
	return true;
}

// return false if it failed
// use vue functions instead of this mess
// id=govOffice
// .setTask(o,c), o is slot number?
// .activeTask(
function set_governor_task(task) {
	if(!has_tech('governor',1)) return false;
	let actualname='';
	// first check if we already have task
	for(let i=0;i<6;i++) if(evolve.global.race.governor.tasks['t'+i]==task) return false;
	// find free slot
	for(let i=0;i<6;i++) if(evolve.global.race.governor.tasks['t'+i]=='none') {
		if(task=='bal_storage') actualname='Crate/Container Management';
		else if(task=='mech') actualname='Mech Constructor';
		else if(task=='trash') actualname='Mass Ejector Optimizer';
		// more hideous traversal. can return null if we have less than 6 slots
		let q=document.getElementById('govOffice')?.childNodes[i+1]?.childNodes[1]?.childNodes[2]?.firstChild;
		if(q!=null) for(let j=0;j<q.childNodes.length;j++) {
			let s=q.childNodes[j];
			if(s.innerHTML==actualname) {
				s.click();
				return true;
			}
		}
	}
	return false;
}

function remove_governor_task(task) {
	if(!has_tech('governor',1)) return false;
	// find task
	for(let i=0;i<6;i++) if(evolve.global.race.governor.tasks['t'+i]==task) {
		let actualname='None';
		let q=document.getElementById('govOffice')?.childNodes[i+1]?.childNodes[1]?.childNodes[2]?.firstChild;
		if(q!=null) for(let j=0;j<q.childNodes.length;j++) {
			let s=q.childNodes[j];
			if(s.innerHTML==actualname) {
				s.click();
				return true;
			}
		}
	}
	return false;
}

// given list of [res1, mul1, res2, mul2 ,...], set multiplicities accordingly
// and also activate advanced
// advanced options are: 0, 1/2, 1, 2, 3, 4
function set_crate_manager(list) {
	let q=document.getElementById('govOffice');
	if(q==null) return false;
	q=q.lastChild;
	if(q.className!='options') return false;
	// find subnode with crate management
	for(let i=0;i<q.childNodes.length;i++) {
		let r=q.childNodes[i];
		if(r.childNodes[0]?.className=='hRow' && r.childNodes[0]?.firstChild?.role=='heading' && r.childNodes[0]?.firstChild?.innerHTML=='Crate/Container Management') {
			let change=false;
			// click advanced
			if(!evolve.global.race.governor.config.bal_storage.adv) {
				let s=r.childNodes[0].childNodes[1].childNodes[0];
				s.click();
				return true;
			}
			let found=false;
			// go through all checkboxes and set to correct amount
			for(let j=0;j<r.childNodes[1].childNodes.length;j++) {
				let s=r.childNodes[1].childNodes[j];
				let res=canonical_resource(s.firstChild.innerHTML);
				let set_to=1
				for(let k=0;k<list.length;k+=2) {
					if(list[k]==res) {
						set_to=list[k+1];
						found=true;
						break;
					}
				}
				let set_to2;
				if(set_to==0) set_to2=0;
				else if(set_to==0.5) set_to2=1;
				else if(set_to==1) set_to2=2;
				else if(set_to==2) set_to2=3;
				else if(set_to==3) set_to2=4;
				else if(set_to==4) set_to2=5;
				else console.log('crate sanity error',set_to);
				if(evolve.global.race.governor.config.bal_storage[res]!=set_to*2) {
if(!evolve.global.race.governor.config.bal_storage.hasOwnProperty(res)) console.log('TODO probably forgot to canonize',res);
					change=true;
					s.childNodes[2].childNodes[1].firstChild.childNodes[set_to2*2+1].firstChild.click();
				}
			}
			return change;
		}
	}
	return false;
}

// handle government change modal. if user spawned it, do nothing
function government_modal() {
	let q=document.getElementById('govModal');
	if(q!=null && global.change_government!='' && evolve.global.civic.govern.type!=global.change_government) {
//	console.log('change from',evolve.global.civic.govern.type,'to',global.change_government);
		q.__vue__.setGov(global.change_government);
		global.change_government=''; 
		return true;
	}
	return false;
}

function spy_action_modal() {
	if(global.spy_action=='') return false; // return, modal spawned by user
	let q=document.getElementById('espModal');
	if(q==null) return;
	// several vue variables:
	// q.__vue__.act = ?
	// q.__vue__.anx = true if annexed i think
	// q.__vue__.buy = true if bought i think
	// q.__vue__.eco = economy strength i guess
	// q.__vue__.esp = ?
	// q.__vue__.hstl = hostility
	// q.__vue__.mil = military strength
	// q.__vue__.occ = true if occupied by force i guess
	// q.__vue__.sab = ?
	// q.__vue__.trn = ?
	// q.__vue__.unrest = unrest level i guess
	if(['influence','sabotage','incite','annex'].includes(global.spy_action)) {
		q.__vue__[global.spy_action](global.spy_id);
		global.spy_action='';
		global.spy_id=-1;
		return true;
	} else if(global.spy_action=='purchase') {
		q.__vue__[global.spy_action](global.spy_id);
		global.spy_action='';
		global.spy_id=-1;
		return true;		
	}
	return false;
}

function is_spacedock_modal_open() {
	let q=document.getElementById('modalBox');
	if(q==null) return false;
	// since the title is generic, check if this is actually the space dock modal
	let r=q.firstChild?.innerHTML;
	return r!=undefined && r=='Space Dock';
}

function spacedock_modal() {
	if(global.bioseed_action=='') return false; // return, modal spawned by user
	let q=document.getElementById('modalBox');
	if(q==null) return false;
	// since the title is generic, check if this is actually the space dock modal
	let r=q.firstChild?.innerHTML;
	if(r==undefined && r!='Space Dock') return false;
	// space dock confirmed
	if(global.bioseed_action=='ship_and_probes') {
		// click 100 times on bioseeder ship to be guaranteed to finish it
		let s=document.getElementById('starDock-seeder');
		if(s==undefined) { console.log('error, bioseeder ship vue not found'); return false; }
		for(let i=0;i<100;i++) s.__vue__.action();
		// click 40 times on space probes to fill queue
		s=document.getElementById('starDock-probes');
		if(s==undefined) { console.log('error, space probes vue not found'); return false; }
		if(s!=undefined) for(let i=0;i<40;i++) s.__vue__.action();
		global.bioseed_action='';
		// close modal
		// TODO not tested
		q=q.nextSibling.click();
		return true;
	} else if(global.bioseed_action=='prep_ship') {
		let s=document.getElementById('starDock-prep_ship');
		if(s==undefined) { console.log('error, prep ship vue not found'); return false; }
		s.__vue__.action();
		global.bioseed_action='';
		q=q.nextSibling.click();
		return true;
	}
	return false;
}

function perform_spy_action(id,spy_action) {
	let q=document.getElementById('foreign');
	if(q==null) return false;
	let r=document.getElementById('gov'+id).childNodes[2].childNodes[2].firstChild;
	// check if espionage button is clickable
	if(r!=null && r.getAttribute('disabled')==null) {
		global.spy_action=spy_action;
		global.spy_id=id;
		r.click();
		return true;
	}
	return false;
}

// return true if we spawned modal
function change_government(government) {
	// exit if we haven't researched government
	if(!has_tech('govern',1)) return false;
	let q=document.getElementById('govType');
	if(q!=null) {
		// bleh terrible traversal
		q=q.childNodes[1].firstChild.firstChild;
		if(q.getAttribute('disabled')==null) {
			global.change_government=government;
			q.click();
			return true;
		}
	}
	return false;
}

// general modal handler. return true if script clicked something
function handle_modals() {
	if(government_modal()) return true;
	if(spy_action_modal()) return true;
	if(spacedock_modal()) return true;
	return false;
}

//----------------------------------
// stuff specific for magic universe
//----------------------------------

// TODO support multiple steps
function increase_ritual(resource) {
	let q=document.getElementById('iPylon');
	if(q!=null) q.__vue__.addSpell(resource);
}

function decrease_ritual(resource) {
	let q=document.getElementById('iPylon');
	if(q!=null) q.__vue__.subSpell(resource);
}

// get mana spent on current rituals
// we have to read it from the game and parse the text
function get_ritual_cost() {
	let q=document.getElementById('iPylon');
	if(q==null) return NaN;
	let str=q.childNodes[1].childNodes[2].innerHTML;
	let pos=str.indexOf(' Mana');
	return str_to_float(str.substring(0,pos));
}

// get mana production with rituals taken out
function get_ritual_mana_production() {
	return get_production('Mana')-get_ritual_cost();
}

// quick fix for misaligned rituals, all rituals should be 0 or have the same value
function fix_misaligned_rituals() {
	if(!evolve.global.race.hasOwnProperty('casting')) return false;
	let c=evolve.global.race.casting;
	// misaligned iff there are at least 3 unique values including 0
	// put 0 in the array to cover the case where all rituals are used
	let a=[c.army,c.crafting,c.factory,c.farmer,c.hunting,c.lumberjack,c.miner,c.science,0];
	let b=[... new Set(a)];
	if(b.length>2) {
		// rituals are misaligned, fix
		let q=document.getElementById('iPylon');
		if(q==null) console.log('rituals exist, but don\'t');
		let min=999999999;
		for(let v of b) if(v>0 && min>v) min=v;
		for(let b in c) {
			let val=c[b];
			while(val>min) decrease_ritual(b),val--;
		}
		return true;
	}
	return false;
}

//------------------------------
// shared code for all run types
//------------------------------

// don't research reset-related techs
const tech_avoid_safeguard=new Set(['demonic_infusion','dark_bomb','purify_essence','procotol66','incorporeal','dial_it_to_11','limit_collider','stabilize_blackhole','exotic_infusion']);

function hell_num(id) {
	if(building_exists('portal',id)) return get_building('portal',id).count;
	return 0;
}

function eden_num(id) {
	if(building_exists('eden',id)) return get_building('eden',id).count;
	return 0;
}

// i suppose it's more desirable to return 0 instead?
function LS_num(id) { return get_building('tauceti',id)?.count; }

// "manually" gather resources
// TODO should i change to vue-actions here? i guess it's fine until proven not fine
function gather_all() {
	// disabled in magic for now
	// dunno if any basic resource gathering action has a cost elsewhere
	if(evolve.global.race.universe=='magic') return;
	for(let resource of ['food','lumber','chrysotile','stone']) {
		var Resource=str_capitalize(resource);
		if(evolve.global.resource[Resource].display) {
			for(let i=0;i<settings.gather_amount;i++) evolve.actions.city[resource].action();
		}
	}
}

// set mimic according to given priority list. if we already have a genus,
// pick the next from the list.
// kindling kindred causes heat to be skipped (not sure if that's good)
// TODO override attempts to set heat mimic when plant exists. it results in
// extremely bad chrysotile production (by earth miners). plants can gene-edit
// in kindling kindred (which is good) and mimic avian
function set_mimic(genuslist) {
	if(get_max_population()==0) return false;
	let genera=get_genera();
	for(let i=0;i<genuslist.length;i++) {
		let genus=genuslist[i];
		if(genus in genera) continue; // matches current genus, pick next
		if(genus=='heat' && has_trait('kindling_kindred')) continue;
		let name;
		// drop-down list has only english string, no identifiers
		// TODO maybe look up localised string
		if(genus=='humanoid') name='Humanoid';
		else if(genus=='carnivore') name='Carnivorous Beast';
		else if(genus=='herbivore') name='Herbivorous Beat';
		else if(genus=='small') name='Small';
		else if(genus=='giant') name='Giant';
		else if(genus=='reptilian') name='Reptilian';
		else if(genus=='avian') name='Avian';
		else if(genus=='insectoid') name='Insectoid';
		else if(genus=='plant') name='Plant';
		else if(genus=='fungi') name='Fungi';
		else if(genus=='aquatic') name='Aquatic';
		else if(genus=='fey') name='Fey';
		else if(genus=='heat') name='Heat';
		else if(genus=='polar') name='Polar';
		else if(genus=='sand') name='Sand';
		else if(genus=='demonic') name='Demonic';
		else if(genus=='angelic') name='Angelic';
		let q=document.getElementById('sshifter');
		if(q!=null && q.childNodes.length>2) {
			let r=q.childNodes[2].childNodes[2].firstChild;
			for(let i=0;i<r.childNodes.length;i++) if(r.childNodes[i].innerHTML==name) {
				r.childNodes[i].click();
				return;
			}
		}
	}
	return false;
}

// set the default job to the first one in the given list
function set_default_job(list) {
	if(evolve.global.civic.d_job!='unemployed') return false;
	for(let i=0;i<list.length;i++) {
		let job=list[i];
		let q=document.getElementById('civ-'+job);
		if(q==undefined) continue;
		// apparently the parameter is needed even on the correct vue
		q.__vue__.setDefault(job);
		return true;
	}
	return false;
}

// distribute workers equally among all jobs in subcategory
// (only used for servants and skilled servants, technically compatible
// with crafters as long as there's no scarletite or quantium)
// parameters:
// - joblist: pointer into job list parent in DOM
// - max: max number of workers
function assign_jobs_equally(joblist,max) {
	if(joblist==0) return; // not found in DOM, abort
	let n=joblist.childNodes.length; // number of entries in job list
	if(n==0) return;                 // no child nodes, abort
	let active=0;                    // number of active jobs
	let amount=[];                   // currently assigned workers to job i
	let visible=[];                  // true=visible
	for(let i=1;i<n;i++) { // start at 1, first entry is header
		let q=joblist.childNodes[i];
		if(q.hasAttribute('style') && q.getAttribute('style')!='') continue;
		active++;
		visible[i]=true;
		amount[i]=q.firstChild.childNodes[1].innerHTML;
	}
	if(active==0) return; // no jobs to assign to, abort silently
	for(let i=1;i<n;i++) if(visible[i]) {
		let q=joblist.childNodes[i];
		while(amount[i]>0) {
			q.childNodes[1].childNodes[0].click();
			amount[i]--;
		}
	}
	for(let i=1;i<n;i++) if(visible[i]) {
		let desired=Math.trunc(max/active);
		let q=joblist.childNodes[i];
		while(desired>amount[i]) {
			q.childNodes[1].childNodes[1].click();
			amount[i]++;
		}
	}
	// spread remainder
	for(let i=1;i<n;i++) if(visible[i]) {
		let q=joblist.childNodes[i];
		q.childNodes[1].childNodes[1].click();
	}
}

// assign jobs according to percentages in list, max is amount of workers
// caller must ensure that all jobs in the list exist
// meh, lots of repeated code
// should probably rewrite with vue
function assign_jobs_percent(dom,list,max) {
	if(dom==null) return;
	if(!Array.isArray(list)) { console.log('assign_jobs expected list, got element',list); return; }
	let n=dom.childNodes.length;
	if(n==0) { console.log('error, joblist not found'); return; }
	let sum=0;
	for(let i=1;i<list.length;i+=2) {
		list[i]=Math.trunc(list[i]/100.0*max);
		sum+=list[i];
	}
	// just spread the remainder from the top
	if(sum<max) for(let i=1;i<list.length;i+=2) if(sum<max) list[i]++,sum++;
	// check that the jobs exist
	let found=0;
	let amount=[];                   // currently assigned workers to job i
	let desired=[];                  // desired amount
	let visible=[];                  // true=visible
	for(let i=1;i<n;i++) {
		let q=dom.childNodes[i];
		if(q.hasAttribute('style') && q.getAttribute('style')!='') continue;
		let str=q.id;
		if(str=='') str=q.firstChild.id;
		visible[i]=true;
		amount[i]=q.firstChild.childNodes[1].innerHTML;
		desired[i]=0;
		for(let j=0;j<list.length;j+=2) if(str==list[j]) {
			desired[i]=list[j+1];
			found++;
			break;
		}
	}
	if(found*2<list.length) { console.log('assign_job_percent: error, not all jobs found',list); return; }
	// convert percentages in list to actual amounts
	// decrease
	for(let i=1;i<n;i++) if(visible[i]) {
		let q=dom.childNodes[i];
		while(amount[i]>desired[i]) {
			q.childNodes[1].childNodes[0].click();
			amount[i]--;
		}
	}
	// increase
	for(let i=1;i<n;i++) if(visible[i]) {
		let q=dom.childNodes[i];
		while(desired[i]>amount[i]) {
			q.childNodes[1].childNodes[1].click();
			amount[i]++;
		}
	}
}

// craft='eq': divide crafters equally among resources
// craft is resource name: all in that resource (ex: craft='Brick')
// craft is '1'+resource name (prefix is digit one): all in that resource,
// except have 1 in the remaining resources. the use case is when we don't have
// a skilled servant on each crafting resource
function apply_population_changes(craft,jobs) {
	let numcrafters=0;
	if(jobs.hasOwnProperty('craftsman')) numcrafters=jobs['craftsman'].desired;
	let numuncappedcrafters=0; // number of uncapped crafter jobs
	let spent=0;
	let one=(craft[0]=='1');
	if(one) craft=craft.slice(1);
	// add crafter jobs to data structure
	for(let res in evolve.craftCost) {
		let mat=evolve.global.resource[res];
		if(!mat?.display) continue;
		let desired=0,current=0,max=0;
		// need to access DOM for current and max number of crafters
		let q=document.getElementById('craft'+res);
		if(q!=null) {
			let value=q.childNodes[1].innerHTML,slash=value.indexOf('/');
			let jobtype;
			if(slash==-1) {
				jobtype='crafter'; // uncapped crafter
				current=parseInt(value);
				max=-1;
			} else {
				jobtype='limitcrafter'; // capped crafter
				current=parseInt(value.substring(0,slash));
				max=parseInt(value.slice(slash+1));
			}
			// only add if uncapped or max>0
			if(max<0) numuncappedcrafters++;
			if(max!=0) jobs[res]={jobtype,desired,current,max};
		}
	}
	// assign crafters
	// one in each job, unless set to all-in
	if(craft=='eq' || one) {
		for(let job in jobs) if(jobs[job].jobtype=='crafter' && spent<numcrafters) spent++,jobs[job].desired++;
	}
	// always fill capped jobs if we can, because scarletite and quantium seems
	// to be always needed
	for(let job in jobs) if(spent<numcrafters && jobs[job].jobtype=='limitcrafter') {
		jobs[job].desired=jobs[job].max;
		spent+=jobs[job].max;
		if(spent+jobs[job].max>numcrafters) jobs[job].desired=numcrafters-spent,spent=numcrafters;
	}
	if(craft=='eq') {
		// distribute equally
		let amount=Math.trunc((numcrafters-spent)/numuncappedcrafters);
		let i=0;
		for(let job in jobs) if(jobs[job].jobtype=='crafter') {
			jobs[job].desired+=amount+(i<(numcrafters-spent)%numuncappedcrafters?1:0);
			i++;
		}
	} else {
		// dump all in one resource
		jobs[craft].desired+=numcrafters-spent;
		spent=numcrafters;
	}
//for(job in jobs) console.log(job,'desired',jobs[job].desired,'current',jobs[job].current,'max',jobs[job].max);
	// set the desired number of workers in the UI
	// first pass: reduce
	for(let job in jobs) if(job!='craftsman' && job!='crew' && jobs[job].desired<jobs[job].current) {
		let id,q;
		if(jobs[job].jobtype=='crafter' || jobs[job].jobtype=='limitcrafter') {
			id='craft'+job;
			q=document.getElementById(id).nextSibling.childNodes[0];
		} else {
			id='civ-'+job;
			q=document.getElementById(id).childNodes[1].childNodes[0];
		}
		while(jobs[job].desired<jobs[job].current) q.click(),jobs[job].current--;
	}
	// second pass: increase
	for(let job in jobs) if(job!='craftsman' && job!='crew' && jobs[job].desired>jobs[job].current) {
		let id,q;
		if(jobs[job].jobtype=='crafter' || jobs[job].jobtype=='limitcrafter') {
			id='craft'+job;
			q=document.getElementById(id).nextSibling.childNodes[1];
		} else {
			id='civ-'+job;
			q=document.getElementById(id).childNodes[1].childNodes[1];
		}
		while(jobs[job].desired>jobs[job].current) q.click(),jobs[job].current++;
	}
}

// for debugging
function get_total_desired(jobs) {
	let desired=0;
	for(let job in jobs) desired+=jobs[job].desired;
	return desired;
}

// only assigns to crafters as a category, not to individual materials
// craft: crafter settings, it's just passed on to apply_population_changes
// miners=false: don't use miners (used when copper and iron production in space is good)
// coalminers=false: don't use coal miners (used when coal production in interstellar is good)
// TODO support colonists (highest priority), titan colonists (also highest
// priority), space miners, archaeologists, ship crew (depopulate other stuff if
// they aren't maxed out), surveyors, ghost trappers, elysium miners,
// pit miners. also meditators, teamsters i guess
// TODO consider rewriting this function, it has become a debugging nightmare
// TODO there's the pitfall of artificial titan colonists, but we never want
// to have titan colonists lower than max, hopefully that doesn't become a problem
// TODO take a list of roles to be depopulated (but keep crafter and surveyor parameters)
// TODO also take in a percentage for basic roles instead of having it hardcoded
function assign_population(craft,miners=true,coalminers=true,surveyors='none') {
	// must have unlocked civics tab, must have >0 max population?
	if(evolve.global.resource[evolve.global.race.species].max==0) return;
	let jobs={};
	for(let jobname in evolve.global.civic) if(evolve.global.civic[jobname].hasOwnProperty('job') && evolve.global.civic[jobname].display==true) {
		let q=evolve.global.civic[jobname];
		let jobtype,desired=0,current=q.workers,max=q.max;
		jobtype=max<0?'basic':'nonbasic';
		jobs[jobname]={jobtype,current,desired,max};
	}
	// adjust the number of farmers depending on storage and production
	let spent=0; // number of workers assigned
	let population=evolve.global.resource[evolve.global.race.species].amount;
	if('farmer' in jobs) {
		jobs.farmer.desired=jobs.farmer.current;
		if(get_ravenous_food_production()<0) {
			// food deficit: add 1 more farmer
			jobs.farmer.desired++;
		} else if(evolve.global.resource.Food.amount>settings.depopulate_farmer_threshold) {
			jobs.farmer.desired--;
			if(jobs.farmer.desired<0) jobs['farmer'].desired=0;
		}
		spent=jobs.farmer.desired;
	}
	if('crew' in jobs) spent+=jobs.crew.current;
	// have at least 1 crafter per crafted material
	let mat=num_crafting_materials();
	if(mat>0 && evolve.global.civic.craftsman.display) {
		// reduce if we don't have enough crafters
		if(mat>evolve.global.civic.craftsman.max) mat=evolve.global.civic.craftsman.max;
		jobs['craftsman'].desired+=mat;
		spent+=mat;
	}
	// assign 1 to each job except scavenger, tormentor, priest
	for(let job in jobs) {
		if('farmer' in jobs) {
			// even if we starve, we really want to produce a little bit of each thing
			while(spent>=population && jobs.farmer.desired>1) {
				jobs.farmer.desired--; spent--;
			}
		}
		if(job=='unemployed' || job=='farmer' || job=='scavenger' || job=='priest' || job=='craftsman' || job=='hell_surveyor') continue;
		if((job=='miner' && !miners) || (job=='coal_miner' && !coalminers)) continue;
		if(jobs[job].desired==0 && jobs[job].max!=0) {
			jobs[job].desired=1;
			spent++;
		}
	}
	// space miners, colonists, titan colonists are important and are filled first
	// miners in warlord can't be reduced, leave at max
	for(let job in jobs) if(job=='space_miner' || job=='colonist' || job=='titan_colonist' || (job=='miner' && evolve.global.race.hasOwnProperty('warlord'))) {
		// use actual amount of assigned space miners
		if(job=='space_miner') {
			jobs[job].max=0;
			if(building_exists('space','elerium_ship')) jobs[job].max+=get_building('space','elerium_ship').count*2*return_pop_modifier();
			if(building_exists('space','iridium_ship')) jobs[job].max+=get_building('space','iridium_ship').count*return_pop_modifier();
			if(building_exists('space','iron_ship')) jobs[job].max+=get_building('space','iron_ship').count*return_pop_modifier();
		}
		let missing=jobs[job].max-jobs[job].desired;
		if(population-spent>=missing) jobs[job].desired+=missing,spent+=missing;
		else jobs[job].desired+=population-spent,spent=population;
	}

	// assign desired amount of surveyors ('none','one','all')
	// TODO convert "one" to suitable number for high population (insect)
	// for highpop=5 i think 8 is safe
	if(jobs.hasOwnProperty('hell_surveyor')) {
		let job='hell_surveyor';
		let num_survey=0;
		if(surveyors=='one') num_survey=Math.trunc(1.4*return_pop_modifier());
		else if(surveyors=='all') num_survey=jobs[job].max;
		if(num_survey>0) {
			if(population-spent>=num_survey) jobs[job].desired=num_survey,spent+=num_survey;
			else jobs[job].desired=population-spent,spent=population;
		}
	}
	// for some magic fraction of total workers, divide them equally among
	// basic jobs that aren't farmers and scavengers
	let tospend=Math.trunc(6+(population-6)*0.08);
	if(tospend>population-spent) tospend=population-spent;
	let num=0; // number of jobs to distribute among
	for(let job in jobs) {
		if(jobs[job].jobtype!='basic' || job=='unemployed' || job=='farmer' || job=='scavenger') continue;
		num++;
	}
	if(num>0) for(let job in jobs) {
		if(jobs[job].jobtype!='basic' || job=='unemployed' || job=='farmer' || job=='scavenger') continue;
		jobs[job].desired+=Math.trunc(tospend/num);
		spent+=Math.trunc(tospend/num);
	}
	// divide the rest of the workers among non-basic jobs, except priests,
	// tormentors, surveyors, space miners
	num=0;     // number of eligible jobs
	let cap=0; // max number of slots to fill
	for(let job in jobs) {
		if(jobs[job].jobtype!='nonbasic' || job=='priest' || job=='torturer' || job=='hell_surveyor' || job=='space_miner') continue;
		if((job=='miner' && !miners) || (job=='coal_miner' && !coalminers)) continue;
		if(jobs[job].max==-1) console.log('sanity error, uncapped specialist job');
		num++;
		cap+=jobs[job].max-jobs[job].desired;
	}
	if(num>0 && cap>0) {
		let fraction=(population-spent)/cap;
		if(fraction>1) fraction=1;
		// assign
		for(let job in jobs) {
			if(jobs[job].jobtype!='nonbasic' || job=='priest' || job=='torturer' || job=='hell_surveyor' || job=='space_miner') continue;
			if((job=='miner' && !miners) || (job=='coal_miner' && !coalminers)) continue;
			spent+=Math.trunc(fraction*(jobs[job].max-jobs[job].desired));
			jobs[job].desired+=Math.trunc(fraction*(jobs[job].max-jobs[job].desired));
		}
	}
	// hire bankers, priests, tormentors in that order
	for(let job of ['banker','priest','torturer']) if(job in jobs) {
		if(population-spent<jobs[job].max-jobs[job].desired) {
			jobs[job].desired+=population-spent;
			spent=population;
		} else {
			spent+=jobs[job].max-jobs[job].desired;
			jobs[job].desired=jobs[job].max;
		}
	}
	// if scavengers exist, dump the rest there
	if('scavenger' in jobs) {
		jobs.scavenger.desired+=population-spent;
		spent=population;
	} else {
		// TODO otherwise, distribute evenly among non-farmer basic jobs
		let num=0;
		for(let job in jobs) {
			if(jobs[job].jobtype!='basic' || job=='unemployed' || job=='farmer') continue;
			num++;
		}
		let remain=Math.trunc((population-spent)/num);
		for(let job in jobs) {
			if(jobs[job].jobtype!='basic' || job=='unemployed' || job=='farmer') continue;
			if(jobs[job].max>=0) continue;
			jobs[job].desired+=remain;
			spent+=remain;
		}
		for(let job in jobs) {
			if(population==spent) break;
			if(jobs[job].jobtype!='basic' || job=='unemployed' || job=='farmer') continue;
			if(jobs[job].max>=0) continue;
			jobs[job].desired++;
			spent++;
		}
	}
	// if we have unspent population, dump the rest on farmers
	// (can happen with ent on non-trashed planet)
	if(population-spent>0 && 'farmer' in jobs) {
		console.log('dumped on farmers');
		jobs.farmer.desired+=population-spent;
	}
	apply_population_changes(craft,jobs);
}

// return true if all worker slots in list are fully filled
function has_free_worker_slots(list) {
	for(let job of list) {
		let e=evolve.global.civic[job];
		if(e==undefined) continue;
		if(e.workers<e.max) return true;
	}
	return false;
}

// return total number of 2 routes
function max_trade_routes() {
	return evolve.global.city.market.mtrade;
}

function num_active_trade_routes() {
	return evolve.global.city.market.trade;
}

// return current number of active trade routes of a given resource
function num_trade_routes(resource) {
	let q=document.getElementById('market-'+resource);
	if(q==null) return 0;
	// 'trade' changes position depending on whether we have manual trading
	q=getchildbyclassname(q,'trade');
	if(q==null) return null;
	return parseInt(q.childNodes[2].innerHTML);
}

function buy_trade_route(resource) {
	let q=document.getElementById('market-'+resource);
	if(q!=null) q.__vue__.autoBuy(resource);
}

function sell_trade_route(resource) {
	let q=document.getElementById('market-'+resource);
	if(q!=null) q.__vue__.autoSell(resource);
}

function cancel_trade_route(resource) {
	let q=document.getElementById('market-'+resource);
	if(q!=null) q.__vue__.zero(resource);
}

function cancel_all_trade_routes() {
	let q=document.getElementById('tradeTotal');
	if(q==null) return;
	q.__vue__.zero();
}

function use_all_trade_routes(sell,buy) {
	if(num_active_trade_routes()>0) return;
	let num=Math.trunc(max_trade_routes()/2);
	for(let i=0;i<num;i++) sell_trade_route(sell);
	for(let i=0;i<num;i++) buy_trade_route(buy);
}

// similar to set_trade_routes_percent, but uses number of trade routes
// instead of percentages
function set_trade_routes(list) {
	if(!Array.isArray(list)) { console.log('set_trade_percentages: expected list'); return false; }
	let res=['Food','Lumber','Chrysotile','Stone','Crystal','Furs','Copper','Iron','Aluminium','Cement','Coal','Oil','Uranium','Steel','Titanium','Alloy','Polymer','Iridium','Helium_3'];
	let current=[];
	let desired=[];
	let num=res.length;
	for(let i=0;i<num;i++) {
		current[i]=num_trade_routes(res[i]);
		desired[i]=0;
	}
	for(let i=0;i<list.length;i+=2) {
		let j=res.indexOf(list[i]);	
		if(j<0) { console.log('invalid trade id',list,list[i]); return; }
		desired[j]=list[i+1];
	}
	// first pass: decrease
	let q=document.getElementById('market-qty').nextSibling;
	for(let i=0;i<num;i++,q=q.nextSibling) {
		if(current[i]>0 && desired[i]==0) q.__vue__.zero(res[i]),current[i]=0;
		if(current[i]>desired[i]) q.__vue__.autoSell(res[i],current[i]-desired[i]),current[i]=desired[i];
	}
	// second pass: increase
	q=document.getElementById('market-qty').nextSibling;
	for(let i=0;i<num;i++,q=q.nextSibling) {
		if(current[i]<0 && desired[i]==0) q.__vue__.zero(res[i]),current[i]=0;
		if(current[i]<desired[i]) q.__vue__.autoBuy(res[i],desired[i]-current[i]),current[i]=desired[i];
	}
}

// list is of the format [resource1, percent1, resource2, percent2 etc
// percent is the % of trade routes that go to its resource
// negative percentage means sell, positive means buy
// to make the routes entrepreneur-compatible, make sure half are sell routes
// example: ['Aluminium',-50,'Oil',25,'Uranium',25]
function set_trade_routes_percent(list) {
	if(!Array.isArray(list)) { console.log('set_trade_routes_percent: expected list, got',list); return false; }
	let total=max_trade_routes();
	let n=list.length;
	for(let i=1;i<n;i+=2) list[i]=Math.trunc(list[i]*total/100.0);
	set_trade_routes(list);
}

// do stuff unique for synth:
// build transmitters, assemble citizens
// TODO should i treat powered and artificial separately?
function synth_management() {
	if(!has_trait('powered')) return false;
	// if low on power, build power buildings
	if(evolve.global.city.power<0 && build_structure(['city-coal_power','city-oil_power'])) return true;
	else if(get_population()==get_max_population() && build_structure(['city-basic_housing','city-farm','city-cottage','city-lodge'])) return true;
	// build wireless transmitters if negative "food" production
	// TODO not tested, but i assume ravenous applies to synthetic
	// TODO don't build wireless transmitters if we don't have enough power for them
	// TODO build mines earler so we can build power producers faster
	if(get_ravenous_food_production()<0 && build_structure(['city-transmitter'])) return true;
	// assemble citizen
	if(get_population()!=get_max_population() && get_production('Food')>=0 && build_structure(['city-assembly'])) return true;
	return false;
}

function hooved_management() {
	if(!has_trait('hooved')) return false;
	// buy horseshoes up to 6 stored
	// TODO adjust for insect
	// i used scalar=2 here, but i lost the functionality
	if(evolve.global.resource.Horseshoe.amount<6*return_pop_modifier() && build_structure(['city-horseshoe'])) return true;
	return false;
}

function slaver_management() {
	// don't bother with slave pens until slave market
	if(!has_trait('slaver') || !has_tech('slaves',2)) return false;
	if(evolve.global.resource.Slave.amount==evolve.global.resource.Slave.max) {
		if(build_structure(['city-slave_pen'])) return true;
		// TODO adjust slave price for truepath
	} else if(evolve.global.resource.Money.amount>25000+settings.slaver_buy_threshold) {
		// buy slave
		if(build_structure(['city-slave_market'])) return true;
	}
	return false;
}

// couldn't find a sensible way to get crate cost
function get_crate_cost_stupid(node) {
	let str=node.innerHTML;
	let pos=str.indexOf('costs ');
	let val=parseInt(str.slice(pos+6));
	let pos2=str.indexOf(' ',pos+8);
	let pos3=str.indexOf(' ',pos2+1);
	let res=str_capitalize(str.substring(pos2+1,pos3-1));
	if(res=='Amber') res='Stone';
	else if(res=='Bones') res='Lumber';
	return [res,val];
}

function can_afford_crate(cost) {
	let amount=get_resource(cost[0])?.amount;
	if(amount==null) return false;
	return amount>=cost[1];
}

// build one crate
function build_crate() {
	let q=document.getElementById('createHead');
	let cost=get_crate_cost_stupid(q.childNodes[1].firstChild);
	if(can_afford_crate(cost)) {
		q.__vue__.crate();
		return true;
	}
	return false;
}

function build_container() {
	let q=document.getElementById('createHead');
	let cost=get_crate_cost_stupid(q.childNodes[2].firstChild);
	if(can_afford_crate(cost)) {
		q.__vue__.container();
		return true;
	}
	return false;
}

// crate management
// emulate governor task
// TODO this function is dumb and ends up querying the same DOM multiple times
function build_crates() {
	// emergency-build crates if we have low steel cap
	if(resource_exists('Crates') && resource_exists('Steel') && evolve.global.resource.Crates.max>0 && evolve.global.resource.Crates.amount==0 && evolve.global.resource.Steel.max<5000 && build_crate()) return true;
	let q=document.getElementById('createHead');
	if(resource_exists('Crates')) {
		let cost=get_crate_cost_stupid(q.childNodes[1].firstChild);
		// TODO change to while loop to speed up
		if(get_resource(cost[0])?.amount>settings.crate_reserve && evolve.global.resource.Crates.amount<evolve.global.resource.Crates.max && build_crate()) return true;
	}
	if(resource_exists('Containers') && resource_exists('Steel')) {
		let cost=get_crate_cost_stupid(q.childNodes[2].firstChild);
		// TODO change to while loop to speed up
		if(get_resource(cost[0])?.amount>settings.container_reserve && evolve.global.resource.Containers.amount<evolve.global.resource.Containers.max && build_container()) return true;
	}
	return false;
}

// return true if something was built
function build_storage_if_capped(list) {
	for(let id of list) {
		let minus=id.indexOf('-');
		if(minus==-1) console.log('probably error, called build_storage without minus with',id);
		let where=id.substring(0,minus);
		let what=id.slice(minus+1);
		let where2=sublocation.get(id);
		if(evolve.global[where][what]!=null && !can_afford_at_max(where,what,where2)) {
			// get bottleneck
			let bn=evolve.global[where][what].bn;
			// for some reason non-earth buildings don't have bn defined
			// guess the likely bottleneck based on building
			// TODO make a function later that returns the actual bottleneck
			if(bn==undefined) {
				if(['interstellar-mining_droid'].includes(id)) bn='Nano_Tube';
				else if(['interstellar-habitat','space-ziggurat','portal-shadow_mine'].includes(id)) bn='Money';
				else if(['space-iridium_mine'].includes(id)) bn='Titanium';
				else if(['space-exotic_lab'].includes(id)) bn='Elerium';
				else if(['interstellar-cruiser'].includes(id)) bn='Deuterium';
				else if(['portal-incinerator','portal-minions'].includes(id)) bn='Infernite';
				else if(['portal-tunneler'].includes(id)) bn='Food';
				else if(['portal-codex','portal-harbor'].includes(id)) bn='Furs';
				else if(['portal-soul_attractor'].includes(id)) bn='Stone';
				else continue;
			}
			if(bn=='Money') {
				if(build_structure(['city-bank'])) return true;
				if(building_exists('interstellar','starport')) {
					if(evolve.global.interstellar.starport.support<evolve.global.interstellar.starport.s_max) {
						if(build_structure(['interstellar-exchange'])) return true;
					}
				}
				let low2=can_afford_arpa('stock_exchange','Money');
				let low=can_afford_arpa_unbounded('stock_exchange');
				// only use up a tiny bit of our crafted resources
				// this is bad and also doesn't use most of our money
				if(low2>=100 && low>5000) return build_arpa_project('stock_exchange');
			} else if(['Steel','Titanium','Alloy'].includes(bn)) {
				if(build_structure(['city-storage_yard','city-warehouse','space-garage','interstellar-warehouse','interstellar-cargo_yard'])) return true;
			} else if(['Chrysotile','Stone','Clay','Copper','Iron','Furs','Crystal'].includes(bn)) {
				if(build_structure(['city-shed','interstellar-warehouse','portal-warehouse'])) return true;
			} else if(['Oil'].includes(bn)) {
				if(build_structure(['city-oil_depot','space-propellant_depot','space-gas_storage'])) return true;
			} else if(['Helium_3'].includes(bn)) {
				if(build_structure(['space-propellant_depot','space-gas_storage'])) return true;
			} else if(['Neutronium'].includes(bn)) {
				if(build_structure(['space-garage'])) return true;
			} else if(['Deuterium'].includes(bn)) {
				if(build_structure(['interstellar-nexus'])) return true;
			} else if(['Nano_Tube'].includes(bn)) {
				if(build_structure(['interstellar-warehouse','space-garage'])) return true;
			} else if(['Infernite','Food'].includes(bn)) {
				if(build_structure(['portal-warehouse'])) return true;
			} else if(['Elerium'].includes(bn)) {
				// don't bother until we have depots in andromeda
			} else if(['Knowledge'].includes(bn)) {
				// can we afford supercollider fully, ignoring knowledge cost?
				let low=can_afford_arpa('lhc','Knowledge');
				let low2=can_afford_arpa('lhc');
				if(low==100 && low2>0) return build_arpa_project('lhc');
			}
		}
	}
	return false;
}

// WARNING!!!! the following code is prone to buy minor trait levels for phage
// if off-by-one bugs or weird stuff happens. make a save, etc, etc.
// buy genes given the priority list
// list is an array of n*2 elements [trait1, weight2, trait2, weight2 etc].
// higher weight means higher priority
// the function tries to buy the trait with the lowest current_genes - weight
// among all traits in the list
// tiebreaker if equal score: earlier position in priorities list
function arpa_genetics_buy_genes(priorities) {
	let traits=['content','ambidextrous','resilient','promiscuous','gambler','tactical','hardy','cunning','fibroblast','metallurgist','persuasive','industrious','analytical','mastery'];
	let current=[-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1];
	let weight=[];
	let bestweight=9999,bestindex=-1;
	for(let i=0;i<traits.length;i++) weight[i]=9999;
	// get current levels bought in this run
	// can't find them in global variables
	// but phage levels are in evolve.global.genes.minor
	let q=document.getElementById('geneticMinor');
	if(q==null) return;
	for(let i=0;i<q.childNodes.length;i++) {
		let z=q.childNodes[i].className.split(' ');
		let str=z[1].slice(2);
		let ix=traits.indexOf(str);
		if(ix<0) console.log('syntax error');
		current[ix]=parseInt(q.childNodes[i].childNodes[1].innerHTML.slice(7));
	}
	for(let i=0;i<priorities.length;i+=2) {
		let ix=traits.indexOf(priorities[i]);
		if(ix<0) { console.log('illegal arpa gene',priorities[i]); return; }
		weight[ix]=current[ix]-priorities[i+1];
		if(bestweight>weight[ix]) bestweight=weight[ix],bestindex=i;
	}
//console.log(priorities);
//console.log(traits);
//console.log(current);
//console.log(weight);
//console.log(bestweight,bestindex);
	for(let i=0;i<q.childNodes.length;i++) if(q.childNodes[i].className.indexOf('t-'+priorities[bestindex])>=0) {
		// try to buy
		let r=q.childNodes[i].childNodes[1];
		let s=r.className;
		// safety guard to avoid spending phage
		if(s.indexOf('pbuy')>=0) return;
		// another safety guard
		if(r.getAttribute('aria-label').indexOf('Phage')>=0) return;
		// check if we can afford priority trait. if we can't, don't bother with others
		if(s.indexOf('has-text-fade')>=0) return;
		r.click();
		break;
	}
}

// remove period or colon at the end if it exists
function arpacostconvert(str) {
	if(str.length==0) return str;
	if(str[str.length-1]=='.' || str[str.length-1]==':') return str.substring(0,str.length-1);
	return str;
}

// return the cost of 1% the next arpa project of the given id
// return as a nested array [[res1,res2,...],[cost1,cost2,...]]
function arpa_project_costs(id) {
	// can we afford? we need to check manually.
	// can't use evolve.actions.arpa.id.cost.resource() because that's the raw cost
	// i ended up doing the pain of parsing the html, and this approach is
	// extremely sensitive to breaking by the smallest formatting change
	let q=document.getElementById('arpa'+id);
	if(q==null) return null;
	let str=q.childNodes[1].childNodes[1].getAttribute('aria-label');
	if(str.indexOf('Insufficient')>=0) return null; // we can't afford 1%, return empty list
	let rawcosts=str.split(' ');
	let cost_res=[];
	let cost_amount=[];
	let numcost=0;
	for(let i=0;i<rawcosts.length;i++) {
		// find first resource name
		if(rawcosts[i]=='$') {
			// we found money
			cost_res[numcost]='Money';
			cost_amount[numcost++]=str_to_float(arpacostconvert(rawcosts[i+1]));
			i++;
		}
		let res=canonical_resource(arpacostconvert(rawcosts[i]));
		if(res=='Sheet') {
			res='Sheet_Metal';
			cost_res[numcost]=res;
			cost_amount[numcost++]=str_to_float(arpacostconvert(rawcosts[i+3]));
			i+=3;
		} else if(res=='Wrought') {
			res='Wrought_Iron';
			cost_res[numcost]=res;
			cost_amount[numcost++]=str_to_float(arpacostconvert(rawcosts[i+3]));
			i+=3;
		} else if(res=='Mud') {
			// "mud brick" is renamed brick for avian genus
			res='Brick';
			cost_res[numcost]=res;
			cost_amount[numcost++]=str_to_float(arpacostconvert(rawcosts[i+3]));
			i+=3;
		} else if(resource_exists(res)) {
			cost_res[numcost]=res;
			cost_amount[numcost++]=str_to_float(arpacostconvert(rawcosts[i+2]));
			i+=2;
			continue;
		}
		// TODO check all possible costs and add more oddities
	}
	return [cost_res,cost_amount];
}

// return how many segments we can afford of given arpa project
// ignore: resource to ignore in the cost (used for knowledge for supercolliders)
function can_afford_arpa_unbounded(id,ignore=null) {
	let z=arpa_project_costs(id);
	// invalid arpa id, arpa tab not unlocked, can't afford 1%
	if(z==null) return 0;
	let cost_res=z[0];
	let cost_amount=z[1];
	let numcost=cost_res.length;
	// check how many segments we can afford
	let low=999999999;
	for(let i=0;i<numcost;i++) {
		if(cost_res[i]==ignore) continue;
		let val=get_resource(cost_res[i]).amount;
		let num=Math.trunc(val/cost_amount[i]);
		if(num<1) return 0; // can't afford 1%
		if(low>num) low=num;
	}
	return low;
}

// return segments we can afford, but capped to 100
function can_afford_arpa(id,ignore=null) {
	let low=can_afford_arpa_unbounded(id,ignore);
	if(low>100) low=100;
	return low;
}

// build the biggest chunk we can afford
// the vue action supports all steps from 1-100, not only those listed!
// arpa projects: lhc (supercollider), launch_facility, monument, railway,
// stock_exchange, roid_eject, nexus, syphon
function build_arpa_project(id) {
	let low=can_afford_arpa(id);
	if(low==null || low==0) return false;
	let max=100-evolve.global.arpa[id].complete;
	// don't build the last segment of mana syphon #80
	if(id=='syphon' && evolve.global.arpa[id].rank==79) max--;
	if(low>max) low=max;
	if(low==0) return false;
	let q=document.getElementById('arpa'+id);
	q.__vue__.build(id,low);
	return true;
}

// if we have a half-finished arpa project, prioritize it until it's finished
// (except for mana syphons)
function finish_unfinished_arpa_project(){
	if(!tab_exists('arpa')) return false;
	let arpa=['lhc','launch_facility','monument','railway','stock_exchange','nexus','roid_eject'];
	for(let x of arpa) if(evolve.global.arpa.hasOwnProperty(x)) {
		if(evolve.global.arpa[x].complete>0 && evolve.global.arpa[x].complete<100) {
			build_arpa_project(x);
			return true;
		}
	}
	return false;
}

// return [resource,cost]
function get_cost_of_next_monument() {
	let list=arpa_project_costs('monument');
	if(list==null) return ['',NaN];
	if(list[0].length!=1) console.log('error, monument doesn\'t have 1 cost, got:',list);
	return [list[0][0],list[1][0]*100];
}

// rituals: army not used unless terrifying trait (balorg)
// or we have hell presense
// percent: percentage of mana production to spent on rituals
function pylon_management(percent) {
	let rit=['farmer','crafting','factory','farmer','hunting','lumberjack','miner','science'];
	if(evolve.global.race.universe!='magic') return;
	let list=['science','miner','crafting','hunting'];
	if(resource_exists('Cement')) list.push('cement');
	if(resource_exists('Lumber')) list.push('lumberjack');
	if(has_trait('terrifying') || evolve.global.portal?.fortress?.patrols>0) list.push('army');
	let c=evolve.global.race.casting;
	if(fix_misaligned_rituals()) return;
	// remove rituals not in list
	for(let b of rit) if(!list.includes(b)) {
		let v=c[b];
		while(v>0) decrease_ritual(b),v--;
	}
	// spent given percent on rituals
	let totalmana=get_ritual_mana_production();
	let currentcost=-get_ritual_cost();
	if(totalmana*percent/100.0>currentcost) {
		// add
		for(let res of list) increase_ritual(res);
	} else {
		// remove
		for(let res of list) decrease_ritual(res);
	}
}

function get_hell_mercenary_cost(id) {
	let q=document.getElementById('fort');
	if(q==null) return NaN;
	let str=q.__vue__.hireLabel(id);
	let pos=str.indexOf('$');
	if(pos<0) return NaN;
	return str_to_float(str.slice(pos+1));
}

function get_eden_mercenary_cost() {
	let q=document.getElementById('sreden_elysium');
	if(q==null) return NaN;
	let str=q.childNodes[3].firstChild.innerHTML;
	let pos=str.indexOf('$');
	if(pos<0) return NaN;
	return str_to_float(str.slice(pos+1));
}

function hire_mercenary() {
	let q=document.getElementById('garrison');
	if(q==null) return false;
	q.__vue__.hire();
	return true;
}

function get_spy_cost(id) {
	let q=document.getElementById('foreign');
	let str=q.__vue__.spyDesc(id);
	let pos=str.indexOf('$');
	if(pos<0) return NaN;
	return str_to_float(str.slice(pos+1));
}

// spy manager:
// - does influence and sabotage
// - tries to purchase each foreign power
// - truepath 4th foreign power: influence until 100%
function spy_management() {
	// check if we can spy at all
	if(!has_tech('spy',2)) return false;
	if(has_tech('rival',1)) {
		// truepath rival power
		// i guess he doesn't exist until after unifying
		// numbered 3 (0-indexed)
		let q=document.getElementById('foreign');
		let spies=evolve.global.civic.foreign.gov3.spy;
		// buy up to 1 spy
		if(spies==0 && !q.__vue__.spy_disabled(3)) {
			let cost=get_spy_cost(3);
			if(get_resource('Money').amount>=cost+settings.spy_buy_threshold) {
				q.__vue__.spy(3);
				return true;
			}
		} else if(spies>=1 && evolve.global.civic.foreign.gov3.hstl>0) {
			// influence until 100%
			if(perform_spy_action(3,'influence')) return true;
		}
		return false;
	}
	// regular powers
	if(has_trait('unified')) return false;
	if(has_tech('unify',2)) return false;
	let q=document.getElementById('foreign');
	for(let i=0;i<3;i++) {
		// foreign power is gone
		let gov=evolve.global.civic.foreign['gov'+i];
		if(gov.anx || gov.buy || gov.occ) continue;
		// what is the point of r here? not used
		let r=document.getElementById('gov'+i).childNodes[2].childNodes[2].firstChild;
		let spies=gov.spy;
		// check if train spy button is enabled
		if(!q.__vue__.spy_disabled(i)) {
			// only buy up to 3 spies
			if(spies<3) {
				let cost=get_spy_cost(i);
				if(get_resource('Money').amount>=cost+settings.spy_buy_threshold) {
					q.__vue__.spy(i);
					return true;
				}
			}
		}
		// if we have 3 spies: purchase if we can afford
		if(spies==3) {
			// problem: we don't know the purchase cost until after we spawn the modal
			// just wing it somewhat. don't spawn the modal until we have money in the
			// expected ballpark (2.5M, 2M, 4.5M) and good money production
			// TODO might be different for truepath
			if(get_resource('Money').amount>settings.spy_purchase_power_thresholds[i]) {
				if(perform_spy_action(i,'purchase')) return true;
			}
		}
		// if we have 1 spy: always action
		// if we have >=2 spies: only do actions if relation is low
		if(spies==1 || (spies>=2 && (gov.hstl>40 || !q.__vue__.spy_disabled(i)))) {
			// influence if relations < 100 and not balorg
			if(gov.hstl>0 && !has_trait('terrifying')) {
				if(perform_spy_action(i,'influence')) return true;
			} else {
				// otherwise sabotage
				if(perform_spy_action(i,'sabotage')) return true;
			}
		}
	}
	return false;
}

// set tax as high as possible with morale >= max morale
// stay within given min,max
// tax will probably end up oscillating between 2 values, but i'm fine with it
function tax_morale_balance(min=20,max=55,maxmorale=9999) {
	if(!evolve.global.civic.taxes.display) return;
	let q=document.getElementById('tax_rates');
	if(q==null) { console.log('taxes not found, shouldn\'t happen'); }
	let tax=evolve.global.civic.taxes.tax_rate,newtax=tax;
	let morale=evolve.global.city.morale.potential;
	let cap=evolve.global.city.morale.cap;
	// check for morale cap overrride
	if(cap>maxmorale) cap=maxmorale;
	if(morale>cap) newtax++;
	else newtax--;
	if(newtax<min) newtax=min;
	if(newtax>max) newtax=max;
	if(newtax>tax) q.__vue__.add();
	if(newtax<tax) q.__vue__.sub();
}

// get power left, except what replicator uses
// this probably won't work with the governor task on
function get_power_minus_replicator() {
	let power=evolve.global.city.power;
	let repl=get_matter_replicator_power();
	if(repl==null) repl=0;
	return power+repl;
}

function get_matter_replicator_power() {
	if(!has_tech('replicator',1)) return;
	let q=document.getElementById('iReplicator');
	if(q==null) { console.log('error, matter replicator not found'); return; }
	return q.__vue__.pow;
}

// no parameter: adjust power, don't change replicated resource
function matter_replicator_management(resource=null) {
	if(!has_tech('replicator',1)) return;
	if(resource!=null && !resource_exists(resource)) return;
	let q=document.getElementById('iReplicator');
	if(q==null) { console.log('error, matter replicator not found'); return; }
	if(resource!=null && q.__vue__.res!=resource && q.__vue__.avail(resource)) q.__vue__.setVal(resource);
	let current=evolve.global.city.power;
	if(current<settings.replicator_power_buffer-1) {
		while(current<settings.replicator_power_buffer-1) q.__vue__.less(),current+=2;
	} else if(current>settings.replicator_power_buffer+1) {
		while(current>settings.replicator_power_buffer+1) q.__vue__.more(),current-=2;
	}
}

// unicorn shrines
// build 25 knowledge shrines, then metal shrines
function build_shrine() {
	if(!has_trait('magnificent')) return false;
	if(!building_exists('city','shrine')) return false;
	let moon=evolve.global.city.calendar.moon;
	let bonus='';
	if(moon%7==0) bonus='cycle';
	else if(moon<7) bonus='morale';
	else if(moon<14) bonus='metal';
	else if(moon<21) bonus='knowledge';
	else bonus='tax';
	if(get_building('city','shrine').know<25 && bonus=='knowledge') return build_structure(['city-shrine']);
	else if(get_building('city','shrine').know>=25 && bonus=='metal') return build_structure(['city-shrine']);
	return false;
}

function sacrificial_altar() {
	if(!has_trait('cannibalize')) return false;
	let r=evolve.global.race;
	let spec=evolve.global.resource[r.species];
	if(spec.amount>=spec.max-10) {
		let a=evolve.global.city.s_alter;
		if(a.harvest>=10 && a.mind>=10 && a.mine>=10 && a.rage>=10) return false;
		let q=document.getElementById('city-s_alter'); 
		q.__vue__.action();
		return true;
	}
	return false;
}

function set_tax_percent(val) {
	if(!evolve.global.civic.taxes.display) return;
	let q=document.getElementById('tax_rates');
	if(q==null) { console.log('taxes not found, shouldn\'t happen'); }
	let current=evolve.global.civic.taxes.tax_rate;
	while(current<val) q.__vue__.add(),current++;
	while(current>val) q.__vue__.sub(),current--;
}

function can_minor_wish() { return has_tech('wish',1) && evolve.global.race.wishStats?.minor==0; }
function can_major_wish() { return has_tech('wish',2) && evolve.global.race.wishStats?.major==0; }
function get_wish_struct() { return evolve.global.race.wishStats; }

// excite, famous, influence, know, love, money, res, strength
function make_minor_wish(x) {
	let q=document.getElementById('minorWish');
	if(q==null) return false;
	// apparently there's a window[string] thingy to make a pointer,
	// but i couldn't get it to work. resorting to ugly if-list instead
	// (i'm not going the eval() route)
	q=q.__vue__;
	if(x=='excite') q.excite();
	else if(x=='famous') q.famous();
	else if(x=='influence') q.influence();
	else if(x=='know') q.know();
	else if(x=='love') q.love();
	else if(x=='money') q.money();
	else if(x=='res') q.res();
	else if(x=='strength') q.strength();
	else { console.log('illegal minor wish',x); return; }
}

// adoration, greatness, money, peace, plasmid, power, res, thrill
function make_major_wish(x) {
	let q=document.getElementById('majorWish');
	if(q==null) return false;	
	q=q.__vue__;
	if(x=='adoration') q.adoration();
	else if(x=='greatness') q.greatness();
	else if(x=='money') q.money();
	else if(x=='peace') q.peace();
	else if(x=='plasmid') q.plasmid();
	else if(x=='power') q.power();
	else if(x=='res') q.res();
	else if(x=='thrill') q.thrill();
	else { console.log('illegal major wish',x); return; }
}

// no vue interface it seems
function set_ocular_power(list) {
	if(!has_trait('ocular_power')) return;
	let slots=2;
	if(evolve.global.race.ocular_power<1) slots=1;
	else if(evolve.global.race.ocular_power>=3) slots=3;
	let q=document.getElementById('ocularPower');
	if(q==null) console.log('ocular sanity error');
	let powers=['d','p','w','t','f','c'];
	let desired=[0,0,0,0,0,0];
	// if list is too long, toss elements we don't have slots for
	for(let i=0;i<list.length && i<slots;i++) {
		let pos=powers.indexOf(list[i]);
		if(pos<0) console.log('ocular list error',list);
		desired[pos]=1;
	}
	let r=q.childNodes[1];
	// uncheck
	for(let i=0;i<6;i++) if(evolve.global.race.ocularPowerConfig[powers[i]] && desired[i]==0) {
		r.childNodes[i].firstChild.click();
	}
	// check
	for(let i=0;i<6;i++) if(!evolve.global.race.ocularPowerConfig[powers[i]] && desired[i]==1) {
		r.childNodes[i].firstChild.click();
	}
}

//-----------------------
// code for MAD territory
//-----------------------

// techs that only terrified trait (balorg) researches in MAD runs
const MAD_balorg_techs=new Set(['armor','mercs','zealotry','espionage','spy']);
// techs that all races avoid in MAD runs
const MAD_avoidlist=new Set(['theocracy','steel_vault','socialist','corpocracy','reinforced_crates','barns','gantry_crane','zoning_permits','assembly_line','kroll_process','casino','gmfood','massive_trades','polymer','alloy_drills','bunk_beds','genetics','stock_market','monuments','uranium_ash','robotics',
'dial_it_to_11','limit_collider']);
// if any of these are capped, build storage
const MAD_capped_list=new Set(['city-garrison','city-smelter','city-oil_well','city-metal_refinery','city-basic_housing','city-farm','city-lodge','city-cottage','city-apartment','city-bank','city-pylon']);

function MAD_research_tech() {
	let avoidlist=MAD_avoidlist.union(tech_avoid_safeguard);
	if(!has_trait('terrifying')) avoidlist=avoidlist.union(MAD_balorg_techs);
	return research_tech(avoidlist);
}

// set smelters to 5 iron, the rest steel. if <10 total, distribute equally
function MAD_set_smelter_output() {
	if(!resource_exists('Steel')) return; // we don't have steel, return
	let smelter=get_building('city','smelter');
	if(smelter!=null) {
		let max=smelter.cap;
		let iron,steel;
		if(max<10) steel=Math.trunc(max/2),iron=max-steel;
		else iron=5,steel=max-5;
		set_smelter_output(iron,steel,0);
	}
}

// TODO fix this later
// right now the script doesn't even buy more nanite factories
function MAD_set_nanite_input() {
	if(has_trait('deconstructor')) set_nanite_input('Stone',50*get_building('city','nanite_factory').count);
}

function MAD_change_government(from,to) {
	if(from!=null && evolve.global.civic.govern.type!=from) return false;
	if(evolve.global.civic.govern.type==to) return false;
	return change_government(to);
}

function MAD_build_basic_structures() {
	return build_structure(['city-basic_housing','city-farm','city-lodge','city-lumber_yard','city-rock_quarry']);
}

function MAD_low_population() {
	let lowpop=10*return_pop_modifier();
	if(get_max_population()<lowpop) {
		if(MAD_build_basic_structures()) return true;
		// build horseshoes if needed for initial population
		if(has_trait('hooved') && get_population()+evolve.global.resource.Horseshoe.amount<10) {
			return build_structure(['city-horseshoe']);
		}
		return true; // don't continue script until we have 10 population
	}
	return false;
}

function MAD_vital_buildings(vital) {
	let missing=false;
	for(let building of vital) if(evolve.global.city.hasOwnProperty(building) && evolve.global.city[building].count==0) {
		// try building one of them
		if(build_structure(['city-'+building])) return true;
		// if we can't build: just skip
		let timeleft=production_time_left('city',building);
		missing=true;
		if(timeleft==NaN) {
			console.log('script stuck on freight yard');
			// special case for freight yard when we can't craft every element
			if(building=='storage_yard' && evolve.global.city.foundry.count<num_crafting_materials()) {
				if(build_structure(['city-foundry'])) return true;
			}
			// time left forever, just skip
			console.log('no production for',building);
			continue;
		}
		// speed up copper if it's slow
		if(evolve.global.city[building].bn=='Copper' && timeleft>60 && build_structure(['city-mine'])) return true;
		// do we have enough storage?
		if(can_afford_at_max('city',building)) continue;
		// not enough storage: buy more
		// if we couldn't afford it: determine the bottleneck, and build
		// suitable storage building
		if(evolve.global.city[building].bn=='Money' && build_structure(['city-bank'])) return true;
		else if(build_structure(['city-shed'])) return true;
	}
	// if none of the missing buildings could be built, abort script and try
	// to build these later
	return missing;
}

// buy extra cement plants because the normal function doesn't.
// usually happens when script waits a long time to buy an oil derrick with
// only 1 cement plant
function MAD_cement() {
	if(!resource_exists('Cement') || !resource_exists('Titanium')) return false;
	return get_building('city','cement_plant').count<5 && build_structure(['city-cement_plant']);
}

function MAD_knowledge_buildings() {
	let need_knowledge=-1;
	let q=document.getElementById('tech-rocketry');
	if(q) need_knowledge=q.firstChild.getAttribute('data-knowledge');
	q=document.getElementById('tech-mad');
	if(q) {
		let cost=q.firstChild.getAttribute('data-knowledge');
		if(need_knowledge<cost) need_knowledge=cost;
	}
	if(need_knowledge<0) need_knowledge=120000;
	if(evolve.global.resource.Knowledge.max<need_knowledge) {
		if(build_structure(['city-university','city-library'])) return true;
		if(evolve.global.city.powered && evolve.global.city.power>0 || evolve.global.resource.Knowledge.max<50000) {
			if(build_structure(['city-wardenclyffe'])) return true;
			// don't buy biolabs before we have uranium storage
			if(has_tech('uranium',2) && build_structure(['city-biolab'])) return true;
		}
	}
	return false;
}

function MAD_spammable_buildings() {
	if(has_tech('agriculture',6)) {
		// turn on all windmills and build new ones
		let onoff=get_enabled_disabled('city-mill');
		if(onoff!=null && onoff[1]>0) enable_building('city-mill');
		if(build_structure(['city-mill'])) return true;
	}
	return build_structure(['city-windmill','city-temple','city-garrison','city-lumber_yard','city-smelter','city-metal_refinery','city-amphitheatre','city-trade','city-oil_well','city-bank','city-captive_housing','city-graveyard','city-soul_well','city-smokehouse','city-pylon']);
}

function MAD_spammable_housing() {
	// don't build if we have unborn citizens
	if(get_population()<get_max_population()) return false;
	// don't build if synth. synth builds in its own function
	if(has_trait('powered')) return false;
	return build_structure(['city-basic_housing','city-farm','city-lodge','city-cottage']);
}

function MAD_worker_buildings() {
	if(!has_free_worker_slots(['miner','cement_worker','craftsman'])) {
		if(build_structure(['city-foundry','city-mine','city-cement_plant'])) return true;
		// stop at around 15 coal mines i guess
		if(num_structures('city-coal_mine')<15 && build_structure(['city-coal_mine'])) return true;
	}
	return false;
}

function MAD_power_buildings() {
	if(evolve.global.city.powered) {
		if(evolve.global.city.power<=0) {
			if(build_structure(['city-coal_power','city-oil_power'])) return true;
		}
		return false;
	}
}

function MAD_spammable_buildings_that_use_power() {
	// synth wants to wait a bit with factories
	if(has_trait('powered')) {
		if(has_tech('uranium',1) && build_structure(['city-factory'])) return true;
	} else {
		// research hunter process before building factories
		if(has_tech('titanium',1) && build_structure(['city-factory'])) return true;
	}
	if(evolve.global.city.power>=0) {
		if(build_structure(['city-rock_quarry','city-sawmill'])) return true;
	}
	// don't build apartments if we have unborn citizens as synth
	if(has_trait('powered') && get_max_population()-get_population()>0) return false;
	if(evolve.global.city.power>=0 && build_structure(['city-apartment'])) return true;
	return false;
}

function MAD_trade() {
	if(has_trait('terrifying')) return; // no trading for balorg
	if(has_tech('high_tech',3) && !has_tech('titanium',1)) {
		// we have industrialization (titanium), but don't have hunter process:
		// trade for titanium
		
	}
	
}

// TODO the trade logic is a mess, and triggers are unreliable
// unify into a single function, and also trade for oil
// if we have researched industrialism but not hunter process:
// trade for titanium
function MAD_trade_titanium() {
	if(has_trait('terrifying')) return;
	if(resource_exists('Titanium')) {
		if(!has_tech('titanium',1)) {
			if(get_resource('Titanium').amount>8000) {
				// we have enough titanium, cancel trade routes
				cancel_all_trade_routes();
			} else if(num_trade_routes('Titanium')==0) {
				// buy for 33% of total income
				let diff=get_production('Money');
				let price=evolve.tradeBuyPrice('Titanium');
				let amount=Math.trunc(diff*0.333/price);
				if(amount*2>max_trade_routes()) amount=Math.trunc(max_trade_routes()/2);
				set_trade_routes(['Stone',-amount,'Titanium',amount]);
			}
			// if we lose money, remove some trade routes
			if(get_production('Money')<0 && num_trade_routes('Titanium')>0) {
				buy_trade_route('Stone');
				sell_trade_route('Titanium');
			}
		} else {
			// we have hunter process, cancel titanium trade routes
			if(num_trade_routes('Titanium')>0) {
				cancel_all_trade_routes();
			}
		}
	}
}

// if we have a factory but haven't researched uranium storage:
// trade for alloy
// BUG: fewer routes in stone than alloy, should be the same
function MAD_trade_alloy() {
	if(has_trait('terrifying')) return;
	if(!resource_exists('Alloy')) return;
	if(!has_tech('uranium',2) && get_building('city','factory').count>=1) {
		if(num_trade_routes('Alloy')==0) {
			// buy for 33% of total income
			let diff=get_production('Money');
			let price=evolve.tradeBuyPrice('Alloy');
			let amount=Math.trunc(diff*0.333/price);
			if(amount*2>max_trade_routes()) amount=Math.trunc(max_trade_routes()/2);
			set_trade_routes(['Stone',-amount,'Alloy',amount]);
		}
	} else if(has_tech('uranium',2) && num_trade_routes('Alloy')!=0) cancel_all_trade_routes();
}

// if we have uranium storage but not mad: trade for uranium and oil
function MAD_trade_uranium() {
	if(has_trait('terrifying')) return;
	if(has_tech('uranium',2) && !has_tech('mad',1)) {
		// we're probably rich by now
		if(num_trade_routes('Uranium')==0) set_trade_routes_percent(['Aluminium',-50,'Uranium',25,'Oil',25]);
		// if we lose money, remove some trade routes
		// TODO i suspect this code could be the partial culprit that causes the
		// script to sell uranium
/*		if(get_production('Money')<0 && num_trade_routes('Uranium')>0) {
			buy_trade_route('Aluminium');
			sell_trade_route('Uranium');
		}*/
	}
	if(has_tech('mad',1) && num_trade_routes('Uranium')>0) cancel_all_trade_routes();
}

function MAD_balorg() {
	if(!has_trait('terrifying')) return false;
	if(build_structure(['city-hospital','city-boot_camp'])) return true;
	// fight for resources, only when we have full army
	if(evolve.global.civic.garrison.workers==evolve.global.civic.garrison.max && evolve.global.civic.garrison.wounded==0) {
		// TODO see if i can do this with more vue actions and less DOM stuff
		let q=document.getElementById('c_battalion');
		if(q!=null) {
			// add all soldiers to battalion
			let num=q.childNodes[2].innerHTML;
			while(num<evolve.global.civic.garrison.max) {
				q.childNodes[3].click();
				num++;
			}
			// change campaign type to assault, seems to be the most efficient one
			// (we don't want to siege and occupy)
			let r=document.getElementById('c_tactics');
			if(r!=null) {
				let str=r.childNodes[2].innerHTML;
				if(str=='Ambush') {
					r.childNodes[3].click();r.childNodes[3].click();r.childNodes[3].click();
				} else if(str=='Raid') {
					r.childNodes[3].click();r.childNodes[3].click();
				} else if(str=='Pillage') {
					r.childNodes[3].click();
				} else if(str=='Siege') {
					r.childNodes[1].click();
				}
			}
			// attack the first power that's alive
			for(let i=0;i<3;i++) {
				let gov=evolve.global.civic.foreign['gov'+i];
				if(gov.anx || gov.buy || gov.occ) continue;
				let s=document.getElementById('gov'+i);
				if(s!=null) s.childNodes[2].firstChild.click()
			}
		}
	}
	return false;
}

function MAD_zen() {
	// build meditation chambers only if zen power is full
	if(evolve.global.resource.hasOwnProperty('Zen') && evolve.global.resource.Zen.amount==evolve.global.resource.Zen.max) {
		if(build_structure(['city-meditation'])) return true;
	}
	return false;
}

// synth stuff specific for mad territory
function MAD_synth_management() {
	if(!has_trait('powered')) return false;
	// synth wants to have some cement plants. power is a struggle, so turn them off
	if(num_structures('city-cement_plant')<5 && build_structure(['city-cement_plant'])) return true;
	let onoff=get_enabled_disabled('city-cement_plant');
	if(onoff!=null && onoff[0]>0) disable_building('city-cement_plant');
	// very low aluminium production: mitigate with trade routes
	// these routes are entrepreneur-legal
	if(!has_trait('terrifying')) {
		if(get_production('Aluminium')<2) {
			sell_trade_route('Stone');
			buy_trade_route('Aluminium');
		} else if(get_production('Aluminium')>20 && (num_trade_routes('Aluminium')!=0 || num_trade_routes('Stone')!=0)) {
			cancel_trade_route('Aluminium');
			cancel_trade_route('Stone');
		}
		if(get_production('Oil')<2) {
			sell_trade_route('Stone');
			buy_trade_route('Oil');
		} else if(get_production('Oil')>20 && (num_trade_routes('Oil')!=0 || num_trade_routes('Stone')!=0)) {
			cancel_trade_route('Oil');
			cancel_trade_route('Stone');
		}
	}
	return false;
}

function MAD_main(governor) {
	if(handle_modals()) return;
	gather_all(); // script is allowed to continue
	if(set_default_job(['quarry_worker','lumberjack','scavenger'])) return true;
	if(spy_management()) return;
	if(MAD_research_tech()) return;
	MAD_set_smelter_output();
	MAD_set_nanite_input();
	set_ocular_power(['t','c']);
	tax_morale_balance(20,55);
	matter_replicator_management('Brick');
	if(set_governor(governor)) return;
	if(MAD_change_government('anarchy','democracy')) return;
	// if we somehow research federation before MAD
	if(has_tech('gov_fed',1) && MAD_change_government(null,'federation')) return;
	if(set_governor_task('bal_storage')) return;
	// trade for titanium, trade routes are entrepreneur-friendly
	MAD_trade_titanium();
	MAD_trade_alloy();
	// TODO trade for steel
	// trade for uranium, oil
	MAD_trade_uranium();
	// build one rock quarry asap to make quarry worker job available
	if(evolve.global.city?.rock_quarry?.count===0 && build_structure(['city-rock_quarry'])) return;
	// build one mine asap to start copper production, needed early if we have horseshoes
	if(evolve.global.city?.mine?.count===0 && build_structure(['city-mine'])) return;
	// build one farm asap to unlock farmers
	if(evolve.global.city?.farm?.count===0 && build_structure(['city-farm'])) return;
	assign_population('eq',true,true);
	// assign servants equally. could be smarter, but whatever
	if(get_max_population()>0 && evolve.global.race.hasOwnProperty('servants')) assign_jobs_equally(document.getElementById('servants'),evolve.global.race.servants.max);
	// assign skilled servants equally
	if(get_max_population()>0 && evolve.global.race.hasOwnProperty('servants')) assign_jobs_equally(document.getElementById('skilledServants'),evolve.global.race.servants.smax);
	// do synth stuff if we're synth
	if(synth_management()) return;
	if(MAD_synth_management()) return;
	// if we have less than 10 population, build housing and basic job structures
	if(MAD_low_population()) return;
	// zen
	if(MAD_zen()) return;
	// set mimic
	if(has_trait('shapeshifter') && get_mimic()=='none' && set_mimic(['heat','avian','plant','small'])) return;
	// fungi: buy compost heap if food production is negative
	if(get_ravenous_food_production()<0 && build_structure(['city-compost'])) return;
	// unstable planets: build more mines if negative iron production because of crafters
	if(get_production('Iron')<0 && build_structure(['city-mine','city-basic_housing','city-farm','city-lodge'])) return;
	// mostly for synth: build metal refineries if aluminium deficit
	if(get_production('Aluminium')<0 && build_structure(['city-metal_refinery'])) return;
	// emergency-build coal mines if coal deficit
	if(get_production('Coal')<0 && build_structure(['city-coal_mine'])) return;
	// buy horseshoes up to 6 if we're hooved
	if(hooved_management()) return;
	if(MAD_cement()) return;
	// halt here until we've built vital buildings
	// also, ensure we have enough steel storage
	if(building_exists('city','smelter') && get_building_count('city','smelter')>5 && building_exists('city','metal_refinery') && get_resource('Steel').amount<2000 && build_crate()) return true;
	if(building_exists('city','factory') && get_resource('Steel').amount<8000 && build_crate()) return true;
	if(MAD_vital_buildings(['bank','garrison','silo','shed','cement_plant','foundry','mine','coal_mine','smelter','storage_yard','trade','oil_well','oil_depot','mill','graveyard','soul_well','farm','pylon','lodge'])) return;
	// build knowledge buildings
	if(MAD_knowledge_buildings()) return;
	if(build_shrine()) return;
	// spam buildings that don't use power or add new jobs
	if(MAD_spammable_buildings()) return;
	// spam basic housing unless we're synth
	if(MAD_spammable_housing()) return;
	// build buildings that create jobs, but not if we have unfilled important
	// worker slots like cement workers and crafters
	if(MAD_worker_buildings()) return;
	// build power if deficit
	if(MAD_power_buildings()) return;
	// spam buildings that require power if we have power surplus
	if(MAD_spammable_buildings_that_use_power()) return;
	// in magic: pylon management
	pylon_management(80);
	// slaver
	if(slaver_management()) return;
	// build storage for capped buildings
	if(build_storage_if_capped(MAD_capped_list)) return;
	// TODO balorg
	if(MAD_balorg()) return;
	// build crates
	if(build_crates()) return;
}

function MAD_bot() {
	// if we're in a scenario, just call the correct bot
	if(evolve.global.race.hasOwnProperty('warlord')) return warlord_bot();
	if(evolve.global.race.hasOwnProperty('lone_survivor')) return lone_survivor_bot();
	if(has_tech('launch_facility',1)) {
		console.log('error, we\'ve entered space, mad bot unsuitable');
		return true;
	}
	MAD_main('educator');
//	MAD_main('noble'); // if we want more plasmids
}

//----------------------------------------------------------------------
// code for bioseed territory
// also includes earth after researching MAD before launching into space
//----------------------------------------------------------------------

// techs that all races avoid in bioseed runs
const bioseed_avoidlist=new Set(['long_range_probes']);
// if any of these are capped, build storage
const bioseed_capped_list=new Set(['city-tourist_center','space-satellite','space-sun_mission','space-gas_moon_mission','space-gas_mining','space-outpost','space-living_quarters','space-ziggurat']);

function bioseed_build_2_monuments() {
	if(!tab_exists('arpa')) return false;
	if(!evolve.global.arpa.hasOwnProperty('monument')) return false;
	if(evolve.global.arpa.monument.rank<2) {
		// cancel old trade routes from mad territory
		// we didn't get a chance to do it in the mad code before being thrown here
		if(num_active_trade_routes()>0) cancel_all_trade_routes();
		// buy the biggest chunk we can afford
		if(build_arpa_project('monument')) return true;
	}
	if(get_building_count('space','station')>0 && evolve.arpa.lhc.rank<1) {
		// build 1 supercollider
		if(build_arpa_project('lhc')) return true;
	}
	return false;
}

function bioseed_build_launch_facility() {
	// wait until we have tourism i guess
	if(!has_tech('monument',2)) return false;
	// if we have tourism we are guaranteed to have arpa
	return evolve.global.arpa.launch_facility.rank<1 && build_arpa_project('launch_facility');
}

function bioseed_factory_management() {
	// number of factories
	// TODO include space factories
	let num=get_num_factory_production_lines();
	if(!resource_exists('Nano_Tube')) {
		// if we don't have polymer, or if launch facility is under production:
		// set all factories to alloy
		if(!resource_exists('Polymer') || (tab_exists('arpa') && evolve.global.arpa.hasOwnProperty('launch_facility') && evolve.global.arpa.launch_facility.complete>0 && evolve.global.arpa.launch_facility.complete<100)) {
			set_factory_production(['Alloy',num]);
		} else {
			// early parts of bioseed: 50/50 between alloy and polymer
			let polymer=Math.trunc(num/2);
			let alloy=num-polymer;
			set_factory_production(['Alloy',alloy,'Polymer',polymer]);
		}
	} else if(resource_exists('Nano_Tube') && num>=7 && (evolve.global.starDock?.seeder==undefined || evolve.global.starDock.seeder.count<100)) {
		// nanotubes + please have at least 10 factories. even that is very low
		// as much as we can on nanotubes, the rest 50/50 between alloy and polymer
		let nano=get_factory_production('Nano');
		if(nano==0) nano=Math.trunc(get_production('Coal')/20);
		else if(get_production('Coal')<0) nano--;
		else if(get_production('Coal')>20) nano++;
		let numleft=num-nano;
		if(numleft<6) { nano-=6-numleft; numleft=6; }
		let polymer=Math.trunc(numleft/2)
		let alloy=numleft-polymer;
		set_factory_production(['Alloy',alloy,'Polymer',polymer,'Nano',nano]);
	} else if(evolve.global.starDock?.seeder?.count==100) {
		// we've built bioseeder ship, no more nanotubes
		let polymer=Math.trunc(num/2)
		let alloy=num-polymer;
		set_factory_production(['Alloy',alloy,'Polymer',polymer]);
	}
}

function earth_buildings_we_always_want() {
	// population
	if(build_structure(['city-basic_housing','city-cottage','city-farm','city-lodge'])) return true;
	if(evolve.global.city.power>0 && build_structure(['city-apartment'])) return true;
	// army
	if(build_structure(['city-garrison'])) return true;
	// power generation
	if(build_structure(['city-mill','city-windmill','city-coal_power','city-oil_power','city-fission_power','space-geothermal'])) return true;
	// knowledge
	if(build_structure(['city-university','city-library'])) return true;
	if(evolve.global.city.power>0 && build_structure(['city-wardenclyffe','city-biolab'])) return true;
	// production
	if(build_structure(['city-smelter','city-metal_refinery','city-pylon'])) return true;	
	if(evolve.global.city.power>0 && build_structure(['city-rock_quarry','city-factory','space-gas_mining','space-red_factory','space-outpost'])) return true;
	// money
	if(build_structure(['city-bank','city-storage_yard'])) return true;
	// make an exception for carnivore, hard to get actual food production
	if((get_ravenous_food_production()>50 || has_trait('carnivore')) && build_structure(['city-tourist_center'])) return true;
	// trade
	if(build_structure(['city-storage_yard','city-trade','city-wharf'])) return true;
	// build job buildings only if we have no unfilled important jobs
	// miner was removed from list because we depopulate them during interstellar
	if(!has_free_worker_slots(['cement_worker','craftsman'])) {
		if(evolve.global.city.power>0) {
			// don't build mines after they are turned off
			// do it easy and don't build mines after i have a few iron ships
			if(has_tech('asteroid',3) && get_building_count('space','iron_ship')<10 && build_structure(['city-mine'])) return true;
			if(build_structure(['city-foundry','city-cement_plant','city-casino','space-spc_casino'])) return true;
			// stop at around 15 coal mines i guess
			if(num_structures('city-coal_mine')<15 && build_structure(['city-coal_mine'])) return true;
		}
		if(build_structure(['city-temple','city-amphitheatre'])) return true;
	}
	if(evolve.global.race.universe=='magic' && can_afford_arpa('nexus')==100 && build_arpa_project('nexus')) return true;
	return false;
}

// can't have enough of these buildings
function bioseed_buildings_we_always_want() {
	// bottlenecks
	if(evolve.global.arpa.launch_facility.rank==1 && !building_exists('space','satellite') && build_structure(['space-test_launch'])) return true;
	if(get_building_count('space','moon_base')<1 && build_structure(['space-moon_mission','space-moon_base'])) return true;
	if(build_one(['space-iridium_mine','space-helium_mine','space-propellant_depot'])) return true;
	if(get_building_count('space','spaceport')<1 && build_structure(['space-red_mission'])) return true;
	if(build_one(['space-spaceport','space-living_quarters','space-garage','space-red_mine','space-fabrication','space-biodome','space-red_factory','space-space_barracks'])) return true;
	if(get_building_count('space','geothermal')<1 && build_structure(['space-hell_mission'])) return true;
	if(build_one(['space-geothermal'])) return true;
	if(get_building_count('space','gas_mining')<1 && build_structure(['space-gas_mission'])) return true;
	if(build_one(['space-gas_mining','space-gas_storage','space-swarm_control','space-swarm_satellite','space-outpost','space-oil_extractor','space-space_station','space-iron_ship','space-elerium_ship'])) return true;
	if(get_building_count('space','swarm_control')<1 && build_structure(['space-sun_mission'])) return true;
	if(get_building_count('space','outpost')<1 && build_structure(['space-gas_moon_mission'])) return true;
	if(get_building_count('space','space_station')<1 && build_structure(['space-belt_mission'])) return true;
	if(get_building_count('space','elerium_ship')>=1 && evolve.global.arpa.lhc.rank==0 && build_arpa_project('lhc')) return true;
	if(build_structure(['space-dwarf_mission'])) return true;
	// population
	if(build_structure(['city-basic_housing','city-cottage','city-farm','city-lodge'])) return true;
	if(evolve.global.city.power>0 && build_structure(['city-apartment'])) return true;
	// army
	if(build_structure(['city-garrison'])) return true;
	// power generation
	if(build_structure(['city-mill','city-windmill','city-coal_power','city-oil_power','city-fission_power','space-geothermal'])) return true;
	// knowledge
	if(build_structure(['city-university','city-library'])) return true;
	if(build_structure(['space-satellite'])) return true;
	if(evolve.global.city.power>0 && build_structure(['city-wardenclyffe','city-biolab'])) return true;
	// production
	if(build_structure(['city-smelter','city-metal_refinery','city-pylon'])) return true;	
	if(evolve.global.city.power>0 && build_structure(['city-rock_quarry','city-factory','space-gas_mining','space-red_factory','space-outpost'])) return true;
	// money
	if(build_structure(['city-bank','city-storage_yard'])) return true;
	// make an exception for carnivore, hard to get actual food production
	if((get_ravenous_food_production()>50 || has_trait('carnivore')) && build_structure(['city-tourist_center'])) return true;
	// trade
	if(build_structure(['city-storage_yard','city-trade','city-wharf'])) return true;
	// build job buildings only if we have no unfilled important jobs
	if(!has_free_worker_slots(['miner','cement_worker','craftsman'])) {
		if(evolve.global.city.power>0) {
			if(build_structure(['city-foundry','city-mine','city-cement_plant','city-casino','space-spc_casino'])) return true;
			// stop at around 15 coal mines i guess
			if(num_structures('city-coal_mine')<15 && build_structure(['city-coal_mine'])) return true;
		}
		if(build_structure(['city-temple','city-amphitheatre'])) return true;
	}
	// production bonus
	if(build_structure(['space-ziggurat'])) return true;
	// mana
	if(evolve.global.race.universe=='magic' && can_afford_arpa('nexus')==100 && build_arpa_project('nexus')) return true;
	// build a second supercollider when we can finish it in its entirety
	if(evolve.global.arpa.lhc.rank<2 && can_afford_arpa('lhc')==100 && build_arpa_project('lhc')) return true;
	// buy gps satellites. titanium is precious, but trading is good
	// at least that doesn't slow down space probes
	if(!has_trait('terrifying') && build_structure(['space-gps'])) return true;
	if(!has_trait('terrifying') && can_afford_arpa('railway')==100 && build_arpa_project('railway')) return true;
	return false;
}

function bioseed_manage_population() {
	assign_population('eq',true,true);
	// assign servants equally. could be smarter, but whatever
	if(get_max_population()>0 && evolve.global.race.hasOwnProperty('servants')) assign_jobs_equally(document.getElementById('servants'),evolve.global.race.servants.max);
	// assign skilled servants equally
	if(get_max_population()>0 && evolve.global.race.hasOwnProperty('servants')) assign_jobs_equally(document.getElementById('skilledServants'),evolve.global.race.servants.smax);
}

// assemble a gene when we're at max knowledge
function bioseed_sequence_genes_manually() {
	// de_novo_sequencing required
	// routine is redundant after rapid gene sequencing
	// (except if we click multiple times here at very high knowledge production)
	if(has_tech('genetics',6) && !has_tech('genetics',8)) {
		let q=document.getElementById('arpaSequence');
		if(q==null) return false;
		if(evolve.global.resource.Knowledge.amount==evolve.global.resource.Knowledge.max && evolve.global.resource.Knowledge.max>=200000) {
			// click assemble gene
			q.__vue__.novo();
			return true;
		}
	}
	return false;
}

function bioseed_buy_minor_traits() {
	// can't do this until i've unlocked genetic sequencing
	let list=[];
	// priorities when in bioseed-land
	// more or less determined on a whim
	list.push('mastery'); list.push(5);
	// ignore hardy if cement doesn't exist
	if(resource_exists('Cement')) list.push('hardy'),list.push(5);
	list.push('analytical'); list.push(5);
	if(!has_trait('terrifying')) list.push('persuasive'); list.push(5);
	if(has_trait('terrifying')) {
		list.push('tactical'); list.push(6);
		list.push('fibroblast'); list.push(4);
	}
	list.push('content'); list.push(4);
	list.push('ambidextrous'); list.push(4);
	list.push('metallurgist'); list.push(4);
	list.push('cunning'); list.push(3);
	list.push('industrious'); list.push(3);
	list.push('promiscuous'); list.push(2);
	list.push('gambler'); list.push(2);
	list.push('resilient'); list.push(1);
	arpa_genetics_buy_genes(list);
}

function bioseed_trade_route_management() {
	// we have satellites but not rovers. also assume we need titanium
	if(!has_tech('space_explore',2) && building_exists('space','satellite') && !resource_exists('Iridium')) set_trade_routes_percent(['Aluminium',-50,'Alloy',30,'Titanium',20]);
	else if(resource_exists('Iridium') && has_tech('space_explore',2) && !has_tech('space_explore',3) && num_trade_routes('Iridium')==0) {
		// we have iridium, but no trade routes on iridium
		set_trade_routes_percent(['Aluminium',-50,'Iridium',45,'Titanium',5]);
	// TODO set some trade routes to helium-3 when we have moon base, helium-3 mine but not space probes
	} else if(has_tech('space_explore',3) && (!building_exists('space','gas_mining') || get_building_count('space','gas_mining')<5)) {
		// we have space probes, we have fewer than helium-3 collectors
		set_trade_routes_percent(['Aluminium',-50,'Iridium','22','Helium_3',22,'Titanium',6]);
	} else if(get_building_count('space','gas_mining')>=5) {
		// we have at least 5 helium-3 collectors and we're still buying helium-3
		// change to a bit of uranium and full iridium instead
		let num2=Math.trunc(max_trade_routes()/2);
		set_trade_routes(['Aluminium',-num2-1,'Uranium',15,'Titanium',15,'Iridium',num2-30]);
	}
}

function bioseed_set_smelter_output() {
	if(!has_tech('irid_smelting',1)) MAD_set_smelter_output();
	else {
		// still don't boost iridium in bioseed-land
		MAD_set_smelter_output();
	}
}

function bioseed_build_on_moon() {
	if(!building_exists('space','moon_base') || !building_exists('space','nav_beacon')) return false;	
	let max=evolve.global.space.moon_base.s_max;
	let cur=evolve.global.space.moon_base.support;
	if(cur>=max) return build_structure(['space-nav_beacon','space-moon_base']);
	// don't need helium-3 mines, helium-3 collectors are much better
	return build_structure(['space-observatory','space-iridium_mine']);
}

function bioseed_build_on_red_planet(){
	if(!building_exists('space','spaceport') || !building_exists('space','red_tower')) return false;
	let max=evolve.global.space.spaceport.s_max;
	let cur=evolve.global.space.spaceport.support;
	if(cur>=max) return build_structure(['space-spaceport','space-red_tower']);
	let list=['space-exotic_lab','space-living_quarters','space-red_mine','space-biodome'];
	// don't build fabrications until we have subspace beacons in interstellar-land
	// also don't build fabrications when we are saving up wrought iron for embassy
	if(has_tech('luna',3)) list.push('space-fabrication'),list.push('space-nav_beacon');
	return build_structure(list);
}

function bioseed_build_on_sun() {
	// extremely low priority. for now, don't build at all
	return false;
}

function bioseed_build_on_belt() {
	if(!building_exists('space','space_station') || !building_exists('space','elerium_ship')) return false;
	// build up to 4 elerium ships in bioseed land
	// if we go the world collider route, let interstellar_main build more
	if(get_building_count('space','elerium_ship')>=4) return false;
	// unpopulated space miner jobs decrease max, use count instead
	let max=evolve.global.space.space_station.count*3*return_pop_modifier();
	let cur=evolve.global.space.space_station.support;
	// max-1 because elerium ships use 2 support
	if(cur>=max-return_pop_modifier()) return build_structure(['space-space_station']);
	return build_structure(['space-elerium_ship']);;
}

// see line 13483 in volch for multisegment stuff
// see line 1317 in volch for arpa projects

// does bioseed stuff up to researching genesis ship
// important: this function must return true/false as it it called by main2
function bioseed_main() {
	if(handle_modals()) return true;
	if(set_default_job(['quarry_worker','lumberjack','scavenger'])) return true;
	MAD_set_nanite_input();
	bioseed_manage_population();
	bioseed_set_smelter_output();
	tax_morale_balance(20,55);
	if(spy_management()) return true;
	if(research_tech(bioseed_avoidlist.union(tech_avoid_safeguard))) return true;
	pylon_management(80);
	if(synth_management()) return true;
	if(slaver_management()) return true;
	bioseed_factory_management();
	// bioseeder ship is finished, prep ship is done, we are only allowed to build:
	// more factories (to build space probes faster)
	// earth housing
	// earth power sources
	if(has_tech('genesis',7)) {
		// TODO set matter replicator to the bottleneck element of space probes
		// there should be only space probes in the queue
		if(evolve.global.queue.queue.length>0 && evolve.global.queue.queue[0].type=='probes') {
			let q=evolve.global.queue.queue[0];
			if(['Polymer','Alloy','Iridium','Chrysotile'].includes(q.bres)) matter_replicator_management(q.bres);
			else matter_replicator_management();
		}
		if(build_structure(['city-factory','space-red_factory'])) return true;
		if(build_structure(['city-basic_housing','city-cottage','city-farm','city-apartment','city-lodge'])) return true;
		if(build_structure(['city-mill','city-windmill','city-coal_power','city-oil_power','city-fission_power'])) return true;
		return;
	}
	matter_replicator_management('Brick');
	if(bioseed_build_2_monuments()) return true;
	// TODO do spy stuff, aim to purchase all foreign powers
	// build most buildings
	if(bioseed_buildings_we_always_want()) return true;
	if(build_shrine()) return;
	if(bioseed_build_launch_facility()) return true;
	bioseed_trade_route_management();
	// these planets need support
	if(bioseed_build_on_moon()) return true;
	if(bioseed_build_on_red_planet()) return true;
	if(bioseed_build_on_sun()) return true;
	if(bioseed_build_on_belt()) return true;
	if(has_tech('gov_fed',1) && MAD_change_government(null,'federation')) return;
	// todo change government from federation to corpocracy (or whatever had the
	// factory bonus) after researching nanotubes (but only if we stop at bioseed)

	// sequence genes manually whenever we can
	// we want this low in the list so we don't sabotage researching techs
	if(bioseed_sequence_genes_manually()) return true;
	bioseed_buy_minor_traits();
	// TODO consider removing terrible genes like hooved

	// build storage for capped buildings
	if(build_storage_if_capped(MAD_capped_list.union(bioseed_capped_list))) return true;

	// build crates. this one takes ages, have it at the bottom
	if(build_crates()) return true;

	return false;
}

function bioseed_spacedock() {
	if(global.bioseed_action!='') return false;
	if(get_building_count('space','star_dock')==0 && build_structure(['space-star_dock'])) return true;
	else if(get_building_count('space','star_dock')==1 && evolve.global.starDock.seeder.count==0) {
		if(is_spacedock_modal_open()) return false;
		// if we tried to build space probes or the bioseeder ship,
		// at least one of these is true: queue is non-empty, and we finished some
		// stuff
		if(!is_build_queue_empty() || evolve.global.starDock.probes.count>0 && evolve.global.starDock.seeder>0) return false;
		let q=document.getElementById('space-star_dock');
		if(q==null) return false;
		// in modal, queue bioseeder ship and fill queue with space probes
		global.bioseed_action='ship_and_probes';
		q.__vue__.trigModal();
		return true;
	} else if(evolve.global.starDock.seeder.count==100) {
		// factories set to produce 0 nanotubes elsewhere in the code
		// prep ship is genesis,7
		if(has_tech('genesis',7)) return false;
		if(is_spacedock_modal_open()) return false;
		// buy prep ship
		global.bioseed_action='prep_ship';
		let q=document.getElementById('space-star_dock');
		if(q==null) return false;
		q.__vue__.trigModal();
		return true;
	}
	return false;
}

// bioseed part 2: build bioseeder ship, prep ship (but don't launch ship)
// also builds space probes until user launches ship
function bioseed_main2() {
	if(handle_modals()) return true;
	tax_morale_balance(20,55);
	if(bioseed_spacedock()) return;
	if(bioseed_main()) return;
}

function bioseed_bot() {
	// if we're in a scenario, just call the correct bot
	if(evolve.global.race.hasOwnProperty('warlord')) return warlord_bot();
	if(evolve.global.race.hasOwnProperty('lone_survivor')) return lone_survivor_bot();
	if(!has_tech('mad',1)) MAD_main('entrepreneur');
	else if(bioseed_main()) return;
	else if(has_tech('genesis',3) && has_tech('high_tech',11)) bioseed_main2();
}

//--------------------------------
// code for interstellar territory
//--------------------------------

// techs that are avoided in interstellar
const interstellar_avoidlist=new Set(['combat_droids']);
const interstellar_capped_list=new Set(['interstellar-habitat','interstellar-mining_droid','interstellar-processing','interstellar-g_factory','city-wardenclyffe','city-biolab','space-satellite','space-observatory','interstellar-far_reach']);

// some kind of weighting system for crafters
// the weight of a crafting resource depends on the following:
// - low cost => higher priority
// - more important building => higher priority
// => priority = low_cost * importance
// all crafters are set to the most important resource
// if we have matter replicator we never focus on aerogel and nanoweave
// extremely important buildings that cost a lot of a crafting resource gets
// cranked up. examples:
// - embassy in andromeda (we set it to important a long time before unlocking it)
// - forward base in truepath
// - ascension megaprojects
// buildings in interstellar that are moderately important:
// - nexus stations when helix nebula support is full
// - mythril when building stellar engine
// - wardenclyffe when not capped on knowledge
function interstellar_crafter_priority() {
}

// same principle as above
// most likely targets for replicating: bolognium, vitreloy, aerogel,
// nanoweave, orichalcum, scarletite
function interstellar_replicator_priority() {
}

function interstellar_replicator_management() {
	// before infernite: replicate bricks i guess
	if(!resource_exists('Infernite')) matter_replicator_management('Brick');
	else if(evolve.global.portal?.fortress?.patrols==0) {
		// infernite discovered, but no patrols in hell yet: infernite
		matter_replicator_management('Infernite');
	} else if(evolve.global.arpa.hasOwnProperty('syphon') && evolve.global.arpa.syphon.rank*100+evolve.global.arpa.syphon.complete>0 && evolve.global.arpa.syphon.rank*100+evolve.global.arpa.syphon.complete<8000) {
		// set to crystals when building mana syphons
		// (or infernite instead? or determine the bottleneck on the fly)
		matter_replicator_management('Crystal');
	} else if(!has_tech('blackhole',4)) {
		// we have patrols in hell and no stellar engine: adamantite
		// TODO determine bottleneck
		if(get_resource('Graphene').amount<60000) matter_replicator_management('Graphene');
		else matter_replicator_management('Adamantite');
	} else {
		// we have stellar engine
		// replicate sheet metal for nexus stations
		if(get_resource('Sheet_Metal').amount<500000) matter_replicator_management('Sheet_Metal');
		else matter_replicator_management('Brick');
	}
	return false;
}

function build_world_collider() {
	if(evolve.global.space.world_collider.count==1859) return false;
	return build_big_structure('space-world_collider',1859);
}

function interstellar_factory_management() {
	let num=get_num_factory_production_lines();
	if(evolve.global.space.world_collider.count<1859) {
		// world collider not done, set factories to mostly alloy and a bit of the
		// rest
		let polymer=4,nanotubes=4;
		let alloy=num-polymer-nanotubes;
		set_factory_production(['Alloy',alloy,'Polymer',polymer,'Nano',nanotubes]);
		return;
	}
	// distribute furs,alloy,polymer,nanotubes,stanene 1,2,2,2,2
	let furs=0,alloy=0,polymer=0,nanotubes=0,stanene=0;
	let has_stanene=has_tech('stanene',1);
	let sum=0;
	for(let i=0;sum<num;i++) {
		if(i%2==1) furs++,sum++;
		if(sum<num) alloy++,sum++;
		if(sum<num) polymer++,sum++;
		if(sum<num) nanotubes++,sum++;
		if(sum<num && has_stanene) stanene++,sum++;
	}
	let list=['Furs',furs,'Alloy',alloy,'Polymer',polymer,'Nano',nanotubes];
	if(has_stanene) list.push('Stanene'),list.push(stanene);
	set_factory_production(list);
}

function interstellar_buildings_we_always_want() {
	// bottlenecks
	if((!building_exists('interstellar','starport') || get_building('interstellar','starport').count==0) && build_structure(['interstellar-alpha_mission'])) return true;
	if((!building_exists('interstellar','xfer_station') || get_building('interstellar','xfer_station').count==0) && build_structure(['interstellar-proxima_mission'])) return true;
	if((!building_exists('interstellar','nexus') || get_building('interstellar','nexus').count==0) && build_structure(['interstellar-nebula_mission'])) return true;
	if((!building_exists('interstellar','citadel') || get_building('interstellar','citadel').count==0) && build_structure(['interstellar-neutron_mission'])) return true;
	if((!building_exists('interstellar','farpoint') || get_building('interstellar','farpoint').count==0) && build_structure(['interstellar-blackhole_mission'])) return true;
	if(building_exists('interstellar','xfer_station') && get_building('interstellar','xfer_station').count==0 && build_structure(['interstellar-xfer_station'])) return true;
	if(building_exists('interstellar','nexus') && get_building('interstellar','nexus').count==0 && build_structure(['interstellar-nexus'])) return true;
	if(building_exists('portal','carport') && get_building('portal','carport').count==0 && build_structure(['portal-carport'])) return true;
	// loose buildings in solar system that don't need support
	// propellant depots are good, it's the cheapest oil storage, which lets us
	// get more carports
	if(build_structure(['space-satellite','space-propellant_depot'])) return true;
	if(build_structure(['space-ziggurat','space-red_factory'])) return true;
	if(build_structure(['space-geothermal','space-spc_casino','space-gas_mining','space-outpost','space-e_reactor'])) return true;
	// TODO don't build marine garrisons and oil extractors when building embassy
	if(build_structure(['space-space_barracks'])) return true;
	// stop building oil extractors at some point
	if(get_building_count('space','oil_extractor')<12 && build_structure(['space-oil_extractor'])) return true;
	// improve healing and training before sending soldiers to hell
	if(build_structure(['city-hospital','city-boot_camp'])) return true;
	if(build_structure(['interstellar-cruiser','interstellar-far_reach'])) return true;
	return false;
}

function interstellar_build_on_belt() {
	// build only iron ships?
	// not sure if i should buy iridium ships also
	// unpopulated space miner jobs decrease max, use count instead
	let max=evolve.global.space.space_station.count*3*return_pop_modifier();
	let cur=evolve.global.space.space_station.support;
	if(cur>=max) return build_structure(['space-space_station']);
	return build_structure(['space-iron_ship']);
}

function interstellar_build_on_belt_elerium() {
	let max=evolve.global.space.space_station.count*3*return_pop_modifier();
	let cur=evolve.global.space.space_station.support;
	if(cur>=max-return_pop_modifier()) return build_structure(['space-space_station']);
	return build_structure(['space-elerium_ship','space-iron_ship']);
}

function interstellar_build_on_alpha_centauri() {
	if(!building_exists('interstellar','starport')) return false;
	if(build_structure(['interstellar-int_factory'])) return true;
	if(building_exists('interstellar','habitat') && build_structure(['interstellar-habitat'])) return true;
	let max=evolve.global.interstellar.starport.s_max;
	let cur=evolve.global.interstellar.starport.support;
	if(cur>=max) {
		let list=['interstellar-starport'];
		// TODO don't build when building embassy
		if(building_exists('interstellar','xfer_station')) list.push('interstellar-xfer_station');
		return build_structure(list);
	}
	if(has_tech('xeno',4) && evolve.global.civic.priest.assigned==evolve.global.civic.priest.max && build_structure(['interstellar-laboratory'])) return true;
	if(has_tech('hell_ruins',4) && !has_free_worker_slots(['cement_worker','craftsman']) && build_structure(['interstellar-laboratory'])) return true;
	return build_structure(['interstellar-mining_droid','interstellar-processing','interstellar-g_factory','interstellar-fusion']);
}

function interstellar_build_on_helix_nebula() {
	// before stellar engine
	if(!building_exists('interstellar','nexus')) return false;
	let max=evolve.global.interstellar.nexus.s_max;
	let cur=evolve.global.interstellar.nexus.support;
	if(cur>=max) {
		if(max==6) return false;
		return build_structure(['interstellar-nexus']);
	}
	if(max<=6) {
		if(building_exists('interstellar','elerium_prospector') && get_building('interstellar','elerium_prospector').count<1 && build_structure(['interstellar-elerium_prospector'])) return true;
		if(building_exists('interstellar','harvester') && get_building('interstellar','harvester').count<5 && build_structure(['interstellar-harvester'])) return true;
		return false;
	} else return build_structure(['interstellar-elerium_prospector']);
	return false;
}

function interstellar_build_on_helix_nebula_elerium() {
	let max=evolve.global.interstellar.nexus.s_max;
	let cur=evolve.global.interstellar.nexus.support;
	if(cur>=max) return build_structure(['interstellar-nexus']);
	return build_structure(['interstellar-elerium_prospector']);
}

function interstellar_build_on_helix_nebula_all() {
	let max=evolve.global.interstellar.nexus.s_max;
	let cur=evolve.global.interstellar.nexus.support;
	if(cur>=max) return build_structure(['interstellar-nexus']);
	return build_structure(['interstellar-elerium_prospector','interstellar-harvester']);
}

function mining_droid_management() {
	if(!building_exists('interstellar','mining_droid')) return;
	let num=evolve.global.interstellar.mining_droid.count;
	// all in adamantite for the first 5
	if(num<=5) set_mining_droid_production(['adam',num]);
	// number 6 and 7 in uranium and coal. at 7 we depopulate coal miners
	else if(num==6) set_mining_droid_production(['adam',num-1,'uran',1]);
	// into adamantite again until 11
	else if(num<=11) set_mining_droid_production(['adam',num-2,'uran',1,'coal',1]);
	else if(num>=12 && num<1000) {
		// baseline: 10 adamantite, 1 coal, 1 uranium
		let left=num-12;
		let adam=10,uran=1,coal=1,alum=0;
		// leftovers: 30% coal, 30% adam, 40% alum
		adam+=Math.trunc(left*0.3); left-=Math.trunc(left*0.3);
		coal+=Math.trunc(left*0.3); left-=Math.trunc(left*0.3);
		alum+=Math.trunc(left*0.4); left-=Math.trunc(left*0.4);
		alum+=left;
		set_mining_droid_production(['adam',adam,'uran',uran,'coal',coal,'alum',alum]);
	}
}

function interstellar_manage_population(craft='eq') {
	// depopulate coal miners if mining droid produces both uranium and coal
	let need_coal_miners=true;
	if(building_exists('interstellar','mining_droid') && evolve.global.interstellar.mining_droid.coal>0 && evolve.global.interstellar.mining_droid.uran>0) {
		need_coal_miners=false;
		// turn off power to coal mines
		let onoff=get_enabled_disabled('city-coal_mine');
		while(onoff[0]>0) disable_building('city-coal_mine'),onoff[0]--;
	}
	let surveyor='none';
	// 1 surveyor if sports governor and we have a carport and we haven't started hell
	// if we have soldiers, max surveyors
	if(building_exists('portal','carport') && get_building('portal','carport').count>=1) {
		if(evolve.global.portal.fortress.patrols>0) surveyor='all';
		else if(evolve.global.race.governor?.g?.bg=='sports') surveyor='one';
	}
	// depopulate miners if we have good iron production in asteroid belt
	// (at least 15 iron ships i guess)
	let need_miners=true;
	if(get_building('space','iron_ship').count>=15) {
		need_miners=false;
		// turn off power to mines
		let onoff=get_enabled_disabled('city-mine');
		while(onoff[0]>0) disable_building('city-mine'),onoff[0]--;
	}
	// TODO focus crafters now
	assign_population(craft,need_miners,need_coal_miners,surveyor);
	// assign servants equally. could be smarter, but whatever
	if(get_max_population()>0 && evolve.global.race.hasOwnProperty('servants')) assign_jobs_equally(document.getElementById('servants'),evolve.global.race.servants.max);
	// assign skilled servants equally
	if(get_max_population()>0 && evolve.global.race.hasOwnProperty('servants')) assign_jobs_equally(document.getElementById('skilledServants'),evolve.global.race.servants.smax);
}

function interstellar_buy_minor_traits() {
	// can't do this until i've unlocked genetic sequencing
	let list=[];
	// priorities when in interstellar-land
	// higher number => more desired
	// more or less determined on a whim
	list.push('mastery'); list.push(5);
	// ignore hardy if cement doesn't exist
	if(resource_exists('Cement')) list.push('hardy'),list.push(5);
	list.push('tactical'); list.push(5);
	list.push('fibroblast'); list.push(4);
	list.push('analytical'); list.push(1);
	if(!has_trait('terrifying')) list.push('persuasive'); list.push(4);
	list.push('content'); list.push(4);
	list.push('ambidextrous'); list.push(5);
	list.push('metallurgist'); list.push(4);
	list.push('cunning'); list.push(3);
	list.push('promiscuous'); list.push(3);
	list.push('gambler'); list.push(2);
	arpa_genetics_buy_genes(list);
}

function interstellar_hell_management(reset_type) {
	if(!tab_exists('portal')) return false;
	if(!building_exists('portal','turret')) return false;
	if(!building_exists('portal','sensor_drone')) return false;
	// manage troops
	// keep an eye on mercenaries cost
	// keep an eye on number of peacekeepers
	// reduce attractor beacons if we're struggling
	// increase attractor beacons if peacekeepers=max and mercenaries cost low
	// increase number of patrols based on some unknown criteria
	// (when we have many attractor beacons)

	// move soldiers to hell when we have >=125 total soldiers and >=8 turrets,
	// all soldiers are trained, none are wounded
	// TODO check that we actually have 75 free soldiers after crew etc are
	// taken into account
	// grenadier: reduce all soldier amount by 2/3 or something and see if it works
	let q=document.getElementById('fort');
	if(q==null) { console.log('sanity error, hell doesn\'t exist'); return false; }
	let modifier=return_pop_modifier();
	if(has_trait('grenadier')) modifier=Math.trunc(modifier*0.67);
	if(evolve.global.portal.fortress.patrols==0 && evolve.global.civic.garrison.max>=125*modifier && evolve.global.civic.garrison.max==evolve.global.civic.garrison.workers && evolve.global.civic.garrison.wounded==0 && get_building('portal','turret').count>7 && get_hell_mercenary_cost()<1000000) {
		let q=document.getElementById('fort');
		if(q==null) { console.log('sanity error, hell doesn\'t exist'); return false; }
		// send 75 soldiers to hell (40 to patrols, 35 to stationed)
		let num=75+get_building_count('portal','guard_post');
		for(let i=0;i<num*modifier;i++) q.__vue__.aNext();
		// set patrol size to 4
		let patrolsize=evolve.global.portal.fortress.patrol_size;
		while(patrolsize<4*modifier) q.__vue__.patSizeInc(),patrolsize++;
		while(patrolsize>4*modifier) q.__vue__.patSizeDec(),patrolsize--;
		// set 10 patrols
		for(let i=0;i<10;i++) q.__vue__.patInc();

		// vue functions:
		// hire(): hire mercenary
		// hireLabel(): mercenary cost string
		// patDec(): decrease number of patrols
		// patInc(): increase number of patrols
		// patSizeDec(): decrease patrol size
		// patSizeInc(): increase patrol size
		// threatLevel(): threat level string (no number)
		// aLast(): remove 1 soldier from fortress
		// aNext(): assign 1 soldier to fortress
		// defense(): "fortress defense rating" string (no number)
		return true;
	}
	// fortress is manned, manage fortress
	if(evolve.global.portal.fortress.hasOwnProperty('assigned') && evolve.global.portal.fortress.assigned>0) {
		// adjust number of patrols if off
		let patrols=evolve.global.portal.fortress.patrols;
		while(patrols<10) q.__vue__.patInc(),patrols++;
		while(patrols>10) q.__vue__.patDec(),patrols--;
		let dead=evolve.global.civic.garrison.max-evolve.global.civic.garrison.workers;
		// adjust if we struggle in hell
		// this will probably have either all or none attractor beacons active
		// wait for lower mercenary cost before enabling
		if(dead>20*modifier) disable_building('portal-attractor');
		else if(dead<4*modifier && get_hell_mercenary_cost()<1000000) enable_building('portal-attractor');
		if(dead>settings.peacekeeper_buffer) {
			// hire mercenary, then remove 1 from fortress to stay at 35
			let cost=get_hell_mercenary_cost();
			if(get_resource('Money').amount>cost) {
				q.__vue__.hire();
				let desired=(35+get_building_count('portal','guard_post'))*modifier;
				let current=evolve.global.portal.fortress.assigned-evolve.global.portal.fortress.patrol_size*evolve.global.portal.fortress.patrols+1;
				while(current>desired) q.__vue__.aLast(),current--;
				while(current<desired) q.__vue__.aNext(),current++;
				return true;
			}
		}
		// unless vacuum collapse reset, build some repair droids,
		// build attractor beacons if we have enough turrets
		if(has_tech('blackhole',4) && !(has_tech('veil',2) && reset_type=='blackhole')) {
			if(get_building_count('portal','repair_droid')<4 && build_structure(['portal-repair_droid'])) return true;
			if(get_building_count('portal','turret')>=15 && build_structure(['portal-attractor'])) return true;
		}
	}
	// build up to 25 turrets (should be enough for forever)
	if(get_building('portal','turret').count<25 && build_structure(['portal-turret'])) return true;
	// always try to buy carport and sensor drone
	if(build_structure(['portal-carport','portal-sensor_drone'])) return true;
	return false;
}

function interstellar_trade_route_management() {
	// magic: buy crystals
	if(evolve.global.race.universe=='magic') set_trade_routes_percent(['Crystal',100]);
	// otherwise: buy uranium
	else set_trade_routes_percent(['Uranium',100]);
}

function interstellar_main(reset_type) {
	if(handle_modals()) return true;
	if(set_default_job(['quarry_worker','lumberjack','scavenger'])) return true;
	MAD_set_nanite_input();
	interstellar_trade_route_management();
	// less mana on rituals when doing vacuum collapse
	if(reset_type=='blackhole' && evolve.global.race.universe=='magic' && evolve.global.portal?.fortress?.patrols>0 && has_tech('veil',2)) pylon_management(40);
	else pylon_management(80);
	interstellar_replicator_management();
	interstellar_buy_minor_traits();
	if(synth_management()) return true;
	if(slaver_management()) return true;
	tax_morale_balance(20,55);
	interstellar_factory_management();
	mining_droid_management();
	// arpa project in progress: finish it before anything else
	if(finish_unfinished_arpa_project()) true;
	// change to theocracy when ziggurat bonus > 350%
	// can't easily find it, so just change when we have infernite
	// tbh that's too early because it ends up being at <200% ziggurat bonus
	if(resource_exists('Infernite') && MAD_change_government(null,'theocracy')) return true;
	// build world collider
	if(build_world_collider()) return true;
	if(build_shrine()) return true;
	matter_replicator_management();
	if(bioseed_build_on_red_planet()) return true;
	if(bioseed_build_on_moon()) return true;
	if(interstellar_buildings_we_always_want()) return true;
	if(earth_buildings_we_always_want()) return true;
	if(research_tech(interstellar_avoidlist.union(tech_avoid_safeguard))) return true;
	if(interstellar_build_on_alpha_centauri()) return true;
	if(interstellar_build_on_helix_nebula()) return true;
	if(interstellar_hell_management(reset_type)) return true;
	if(has_tech('alpha',1) && evolve.global.arpa.stock_exchange.rank<1) {
		// build 1 stock exchange when we've reached alpha centauri
		if(build_arpa_project('stock_exchange')) return true;
	}

// TODO set smelter to 5 iron, 5 iridium, the rest steel
// TODO build supercolliders whenever we can afford everything except knowledge

	// if morale is capped, build monument if we can afford it at once
	if(evolve.global.city.morale.potential>evolve.global.city.morale.current) {
		let low=can_afford_arpa('monument');
		if(low==100 && build_arpa_project('monument')) return true;
	}

	// build storage for capped buildings
	if(build_storage_if_capped(MAD_capped_list.union(bioseed_capped_list).union(interstellar_capped_list))) return true;

	// we're in magic, blackhole reset, have soldiers in hell, have researched
	// calibrated sensors: start building mana syphons i guess
	// TODO should probably build up infernite production a bit? more carports,
	// more sensor drones
	if(has_tech('infernite',4) && reset_type=='blackhole' && evolve.global.race.universe=='magic' && evolve.global.portal?.fortress?.patrols>0 && has_tech('veil',2)) {
console.log('vacuum collapse reset');
		interstellar_manage_population();
		if(interstellar_build_on_belt()) return true;
		if(build_arpa_project('syphon')) return true;
		return build_crates();
	}
	// if we're doing blackhole outside of magic, or doing a higher reset
	// build stellar engine, build mass ejectors
	// wait until we have entered hell
	if((evolve.global.race.universe!='magic' || reset_type!='blackhole') && evolve.global.portal?.fortress?.patrols>0 && !has_tech('blackhole',4)) {
console.log('build stellar engine');
		// maybe build up production first (adamantite, graphene, neutronium,
		// infernite)
		// build stellar engine
		interstellar_manage_population();
		if(interstellar_build_on_belt()) return true;
		if(!has_tech('blackhole',4)) {
			return build_big_structure('interstellar-stellar_engine',100);
		}
		// beef up elerium and infernite production
		// build attractor beacons in hell (find some way to push them while
		// also surviving)
		return build_crates();
	}
	if(evolve.global.race.universe!='magic' && reset_type=='blackhole' && has_tech('blackhole',4)) {
console.log('black hole reset');
		if(get_building('interstellar','mass_ejector').count>=1) {
			if(set_governor_task('trash')) return true;
			// TODO configure and toss copper production above a certain level
			// TODO toss above given infernite production
			// elerium gets tossed by itself i guess, even in antimatter
			// (might want to change at extremely high storage)
			// it's not even urgent though, only takes a few hours to destabilization
		}
		// build just enough mass ejectors to cover all infernite and elerium
		// production
		// if we're on pace to get 10 soul gems before 0.025 exotic solar mass,
		// build repair drones
		// antimatter probably wants a percentage of elerium production to be
		// tossed because of high caps
		// craft mythril (or wrought iron if we have enough), replicate sheet metal
		if(get_resource('Mythril').amount>500000) interstellar_manage_population('Wrought_Iron');
		else interstellar_manage_population('Mythril');
		if(interstellar_build_on_helix_nebula_elerium()) return true;
		if(interstellar_build_on_belt_elerium()) return true;
		if(build_structure(['interstellar-mass_ejector'])) return true;
		return build_crates();
	}

	if(reset_type!='blackhole' && has_tech('blackhole',4)) {
console.log('before wormhole');
		if(get_building('interstellar','mass_ejector').count>=1) {
			if(set_governor_task('trash')) return true;
		}
		// build lots of mass ejectors
		// build up production of elerium, neutronium
		// i guess andromeda_bot really should take over at this point,
		// but maybe build a mass ejector and set governor task
		// build swarm satellites
		interstellar_manage_population();
		if(interstellar_build_on_belt()) return true;
		if(get_resource('Mythril').amount>500000) interstellar_manage_population('Wrought_Iron');
		else interstellar_manage_population('Mythril');
		if(interstellar_build_on_helix_nebula_all()) return true;
		if(interstellar_build_on_belt()) return true;
		if(build_structure(['interstellar-mass_ejector'])) return true;
		return build_crates();
	}
console.log('before stellar engine');
	// fallback, here be before stellar engine and mana syphon
	interstellar_manage_population();
	if(interstellar_build_on_belt()) return true;

	// it's andromeda_bot's responsibility to build wormhole
	if(build_crates()) return true;
	return false;

// old notes

// interstellar: build mining droids, processing facilities, graphene plants.
// in hell: build 1 carport surveyor to unlock infernite, set replicator to
// infernite. if sports, set 1 worker to infernite (he's immortal)

// on earth: build almost everything that increases population and production:
// all population buildings, banks, tourist centers, amphitheaters, casinos,
// all knowledge buildings, all military buildings, trade posts,
// quarries, cement plants, foundries, factories, smelters, metal refineries,
// all power buildings
// build earth storage only on demand

// in asteroid belt: build iron mining ships

// factories: we need all of aluminium, polymer, nanotubes, stanene. just
// distribute them equally?

// mining droid: set 1 to coal, 1 to uranium very early, depopulate all
// coal miners, turn off power
// whenever we have graphene and stanene, set crate management to:
// 3x aluminium, 2x polymer, 3x graphene, 3x stanene

// crafting: probably biggest need for bricks

// after researching patrol cruisers, set matter replicator to aerogel.
// if no replicator, set all crafters to aerogel for a while
// after subspace beacons, build fabrications freely

// during interstellar, build all power sources

// black hole reset: don't spend soul gems except for virtual reality tech
// run that goes to andromeda: research hellfire furnace, quantum entanglement,
// build 1 citadel station. don't research combat droids. 

// we want like 300 MW or more before building wormhole. build dyson net first

}

// 'blackhole' parameter also for magic and vacuum collapse
function blackhole_bot() {
	// if we're in a scenario, just call the correct bot
	if(evolve.global.race.hasOwnProperty('warlord')) return warlord_bot();
	if(evolve.global.race.hasOwnProperty('lone_survivor')) return lone_survivor_bot();
	if(!has_tech('mad',1)) MAD_main('sports');
	else if(!has_tech('genesis',3) || !has_tech('high_tech',11)) bioseed_main();
	else interstellar_main('blackhole');
}

//---------------------------------------------------
// ascend (farm harmony crystals, quick change custom
//---------------------------------------------------

// when in andromeda, set all crafters on wrought iron and save all of it for
// embassy 
// soul forge: don't buy gun emplacements since they cost wrought iron (never
// buy them anyway i guess). or just ignore soul forge entirely i guess, it
// has poor soul gem production and its main use is to get a corrupted soul gem

//--------------------
// pillar, then ascend
//--------------------

function build_supercollider_minus_knowledge() {
	let low=can_afford_arpa('lhc','Knowledge');
	let low2=can_afford_arpa('lhc');
	if(low==100 && low2>0 && build_arpa_project('lhc')) return true;
	return false;
}

// TODO this routine could REALLY benefit from building more than one at a time
function build_swarm_satellites() {
	if(build_structure(['space-swarm_plant'])) return true;
	let cur=evolve.global.space.swarm_control.support;
	let max=evolve.global.space.swarm_control.s_max;
	if(cur>=max) return build_structure(['space-swarm_control']);
	return build_structure(['space-swarm_satellite']);
}

function build_early_stargate() {
	let cur=evolve.global.galaxy.starbase.support;
	let max=evolve.global.galaxy.starbase.s_max;
	// require some minimum power
	if(cur+1>max && get_power_minus_replicator()>150) {
		return build_structure(['galaxy-telemetry_beacon','galaxy-starbase']);
	} else if(cur+1<=max && evolve.global.civic.priest.assigned==evolve.global.civic.priest.max) {
		// require enough population before building ships
		// i went for maxed priests
		// also require a minimum number of peacekeepers i guess
		return build_structure(['galaxy-bolognium_ship']);
	} else if(cur+1<=max) {
		// build 1 bolognium ship even if population is not high
		if(get_building_count('galaxy','bolognium_ship')<1 && build_structure(['galaxy-bolognium_ship'])) return true;
		// build 1 scout ship if event hasn't happened, also if population is not high
		if(!has_tech('xeno',1) && get_building_count('galaxy','scout_ship')<1 && build_structure(['galaxy-scout_ship'])) return true;
		// bypass population requirement for second contact
		if(has_tech('infernite',5)) {
			// build ships for second contact: 2 scouts, 1 corvette
			if(get_building_count('galaxy','scout_ship')<2 && build_structure(['galaxy-scout_ship'])) return true;
			if(get_building_count('galaxy','corvette_ship')<1 && build_structure(['galaxy-corvette_ship'])) return true;
		}
	}
	return false;
}

function andromeda_replicator_management() {
	if(!resource_exists('Bolognium')) matter_replicator_management('Brick');
	else if(get_resource('Aerogel').amount<100000) matter_replicator_management('Aerogel');
	else if(resource_exists('Vitreloy') && get_resource('Vitreloy').amount<5000000) matter_replicator_management('Vitreloy');
	else if(get_resource('Aerogel').amount<1200000) matter_replicator_management('Aerogel');
	else if(resource_exists('Orichalcum') && get_resource('Orichalcum').amount<5000000) matter_replicator_management('Orichalcum');
	else if(get_resource('Bolognium').amount<5000000) matter_replicator_management('Bolognium');
	else if(get_resource('Aerogel').amount<3500000) matter_replicator_management('Aerogel');
	else if(get_resource('Sheet_Metal').amount<2000000) matter_replicator_management('Sheet_Metal');
	else matter_replicator_management('Brick');
}

function andromeda_build_gorddon() {
	if(build_structure(['galaxy-dormitory','galaxy-telemetry_beacon'])) return true;
	if(has_exact_tech('dyson',1) && build_big_structure('interstellar-dyson_sphere',100)) return true;
	return false;
}

// i'm too lazy to make a more fancy fleet management system
// system: 0-5 (0 can't be accessed directly)
// ship: 0-4 (0=scout, 1=corvette, 2=frigate, 3=cruiser, 4=dreadnought)
function andromeda_ship_ui(system,ship,b) {
	let q=document.getElementById('hfleet');
	q=q.nextSibling; // id='fleet'
	// childnodes 1-5: each ship type
	// childnodes 1-6: each system (no buttons on first one)
	let r=q.childNodes[1+ship].childNodes[1+system];
	// child 0: remove ship, child 2: add ship
	r.childNodes[b].click();
}

function andromeda_remove_ship(system,ship) {
	andromeda_ship_ui(system,ship,0);
}

function andromeda_add_ship(system,ship) {
	andromeda_ship_ui(system,ship,2);
}

// build in alien2
// parameters are max of each ship
function andromeda_build_alien2(max1,max2=0,max3=0) {
	let cur=evolve.global.galaxy.foothold.support;
	let max=evolve.global.galaxy.foothold.s_max;
	if(cur+1>max) {
		return build_structure(['galaxy-foothold']);
	} else {
		// build at least 1 of each
		if(get_building_count('galaxy','armed_miner')<1 && build_structure(['galaxy-armed_miner'])) return true;
		if(get_building_count('galaxy','ore_processor')<1 && build_structure(['galaxy-ore_processor'])) return true;
		if(get_building_count('galaxy','scavenger')<1 && build_structure(['galaxy-scavenger'])) return true;
		// then build normally
		if(get_building_count('galaxy','armed_miner')>0 && get_building_count('galaxy','ore_processor')>0 && get_building_count('galaxy','scavenger')>0) {
			if((max1==0 || get_building_count('galaxy','armed_miner')<max1) && build_structure(['galaxy-armed_miner'])) return true;
			if((max2==0 || get_building_count('galaxy','ore_processor')<max2) && build_structure(['galaxy-ore_processor'])) return true;
			if((max3==0 || get_building_count('galaxy','scavenger')<max3) && build_structure(['galaxy-scavenger'])) return true;
		}
	}
	return false;
}

// spam freely i guess
// TODO maybe don't spam corsairs since they are super-expensive
function andromeda_build_chthonian() {
	if(build_structure(['galaxy-minelayer','galaxy-excavator'])) return true;
	if(build_structure(['galaxy-raider'])) return true;
	return false;
}

// 5 iron, 15 idirium, the rest in steel
// TODO set all fuelled to oil
function andromeda_set_smelter() {
	let cap=evolve.global.city.smelter.cap;
	set_smelter_output(5,cap-20,15);
}

// this routine takes over after stellar engine has been built
// and stops after we're established in chthonian (1 dreadnought in system 5,
// maybe 2 dreadnoughts in chthonian)
function andromeda_early_main() {
	if(handle_modals()) return true;
	if(set_default_job(['quarry_worker','lumberjack','scavenger'])) return true;
	MAD_set_nanite_input();
	interstellar_trade_route_management();
	pylon_management(80);
	interstellar_buy_minor_traits();
	if(synth_management()) return true;
	if(slaver_management()) return true;
	tax_morale_balance(20,55);
	matter_replicator_management();
	mining_droid_management();
	if(build_shrine()) return true;
	if(finish_unfinished_arpa_project()) true;
	if(interstellar_hell_management('ascension')) return true;
	andromeda_set_smelter();
	// research in manual mode because we don't want advanced drones and orichalcum dyson plating,
	// and we want the first bolognium techs in a specific order
	if(get_building_count('portal','turret')>=15 && research_given_techs(new Set(['combat_droids','stabilize_blackhole','xeno_linguistics','corvette_ship','soul_forge','gun_emplacement','xeno_culture','expedition','enhanced_censors','stellar_smelting','stellar_forge','cultural_exchange','defense_platform','dyson_sphere2','metaphysics','fertility_clinic','ship_dock','frigate_ship','enhanced_sensors','advanced_telemetry','gateway_depot','shore_leave','soul_attractor','mega_manufacturing','subspace_sensors','soul_absorption','soul_link','hedge_funds','four_oh_one','otb','exchange','online_gambling','industrial_partnership','cruiser_ship','xeno_tourism','foreign_investment','ore_processor','scavenger','alien_database','nanoweave','gauss_rifles','coordinates','dreadnought','embassy_housing','hammocks','nanoweave_containers','nanoweave_vest','chthonian_survey','corrupt_gem_analysis','hell_search','orichalcum_analysis','luxury_condo','orichalcum_capacitor','advanced_emplacement','high_tech_factories','orichalcum_panels','orichalcum_driver','scout_ship','asteroid_redirect']))) return true;
	if(get_building_count('interstellar','citadel')<1 && build_structure(['interstellar-citadel'])) return true;
	// scout the pit is "free"
	if(has_exact_tech('hell_pit',1) && build_structure(['portal-pit_mission'])) return true;
	if(has_exact_tech('hell_pit',2) && build_structure(['portal-assault_forge'])) return true;
	// build soul forge - required for corrupt soul gem
	if(has_tech('hell_pit',3) && get_building_count('portal','soul_forge')<1 && evolve.global.civic.garrison.workers-evolve.global.civic.garrison.crew-evolve.global.civic.garrison.m_use>100) {
		if(build_structure(['portal-soul_forge'])) return true;
	}
	if(has_tech('hell_pit',3) && get_building_count('portal','soul_forge')==1) {
		if(get_building_count('portal','gun_emplacement')<12 && build_structure(['portal-gun_emplacement'])) return true;
		if(build_structure(['portal-soul_attractor'])) return true;
	}
	if(get_building_count('interstellar','dyson')<100) {
		console.log('dyson net');
		if(get_resource('Mythril').amount>500000) interstellar_manage_population('Wrought_Iron');
		else interstellar_manage_population('Mythril');
		interstellar_replicator_management();
		set_factory_production_percent_check_cap(['Furs',12,'Alloy',22,'Polymer',22,'Stanene',22,'Nano',22]);
		// arpa project in progress: finish it before anything else
		if(bioseed_build_on_red_planet()) return true;
		if(research_tech(interstellar_avoidlist.union(tech_avoid_safeguard))) return true;
		if(bioseed_build_on_moon()) return true;
		if(interstellar_buildings_we_always_want()) return true;
		if(earth_buildings_we_always_want()) return true;
		if(interstellar_build_on_alpha_centauri()) return true;
		if(interstellar_build_on_helix_nebula_all()) return true;
		// if morale is capped, build monument if we can afford it at once
		if(evolve.global.city.morale.potential>evolve.global.city.morale.current) {
			let low=can_afford_arpa('monument');
			if(low==100 && build_arpa_project('monument')) return true;
		}
		if(build_structure(['interstellar-mass_ejector'])) return true;
		// build storage for capped buildings
		if(build_storage_if_capped(MAD_capped_list.union(bioseed_capped_list).union(interstellar_capped_list))) return true;
		if(interstellar_build_on_belt()) return true;
		if(build_big_structure('interstellar-dyson',100)) return true;
		if(build_supercollider_minus_knowledge()) return true;
		if(build_swarm_satellites()) return true;
		return build_crates();
	}
	// build wormhole
	if(!has_tech('stargate',4)) {
		console.log('todo wormhole');
		if(get_resource('Mythril').amount>500000) interstellar_manage_population('Wrought_Iron');
		else interstellar_manage_population('Mythril');
		interstellar_replicator_management();
		set_factory_production_percent_check_cap(['Furs',12,'Alloy',22,'Polymer',22,'Stanene',22,'Nano',22]);
		// arpa project in progress: finish it before anything else
		if(bioseed_build_on_red_planet()) return true;
		if(research_tech(interstellar_avoidlist.union(tech_avoid_safeguard))) return true;
		if(bioseed_build_on_moon()) return true;
		if(interstellar_buildings_we_always_want()) return true;
		if(earth_buildings_we_always_want()) return true;
		if(interstellar_build_on_alpha_centauri()) return true;
		if(interstellar_build_on_helix_nebula_all()) return true;
		// if morale is capped, build monument if we can afford it at once
		if(evolve.global.city.morale.potential>evolve.global.city.morale.current) {
			let low=can_afford_arpa('monument');
			if(low==100 && build_arpa_project('monument')) return true;
		}
		if(build_structure(['interstellar-mass_ejector'])) return true;
		// build storage for capped buildings
		if(build_storage_if_capped(MAD_capped_list.union(bioseed_capped_list).union(interstellar_capped_list))) return true;
		if(interstellar_build_on_belt()) return true;
		if(build_supercollider_minus_knowledge()) return true;
		if(has_exact_tech('stargate',1) && build_structure(['interstellar-jump_ship'])) return true;
		if(has_exact_tech('stargate',2) && build_structure(['interstellar-wormhole_mission'])) return true;
		if(has_exact_tech('stargate',3) && get_power_minus_replicator()>=500 && build_big_structure('interstellar-stargate',200)) return true;
		if(build_swarm_satellites()) return true;
		return build_crates();
	}
	// andromeda, up to embassy
	// stop building swarm satellites now, we need iridium for other stuff
	if(!has_tech('xeno',4)) {
		console.log('start of andromeda');
		if(get_resource('Mythril').amount>500000) interstellar_manage_population('Wrought_Iron');
		else interstellar_manage_population('Mythril');
		andromeda_replicator_management();
		set_factory_production_percent_check_cap(['Furs',12,'Alloy',22,'Polymer',22,'Stanene',22,'Nano',22]);
		// arpa project in progress: finish it before anything else
		if(bioseed_build_on_red_planet()) return true;
		if(bioseed_build_on_moon()) return true;
		if(interstellar_buildings_we_always_want()) return true;
		if(earth_buildings_we_always_want()) return true;
		if(interstellar_build_on_alpha_centauri()) return true;
		if(interstellar_build_on_helix_nebula_all()) return true;
		// TODO build supercolliders whenever we can afford everything except knowledge
		// if morale is capped, build monument if we can afford it at once
		if(evolve.global.city.morale.potential>evolve.global.city.morale.current) {
			let low=can_afford_arpa('monument');
			if(low==100 && build_arpa_project('monument')) return true;
		}
		if(build_structure(['interstellar-mass_ejector'])) return true;
		// build storage for capped buildings
		if(build_storage_if_capped(MAD_capped_list.union(bioseed_capped_list).union(interstellar_capped_list))) return true;
		if(interstellar_build_on_belt()) return true;
		if(build_supercollider_minus_knowledge()) return true;
		if(research_given_techs(new Set(['hydroponics']))) return true;
		if(has_tech('mars',6) && research_given_techs(new Set(['bolognium_alloy_beams']))) return true;
		if(has_tech('housing_reduction',4) && research_given_techs(new Set(['shield_generator']))) return true;
		if(get_building_count('galaxy','gateway_station')<1 && build_structure(['galaxy-gateway_station'])) return true;
		if(get_building_count('galaxy','telemetry_beacon')<1 && build_structure(['galaxy-telemetry_beacon'])) return true;
		if(has_exact_tech('gateway',1) && build_structure(['galaxy-gateway_mission'])) return true;
		if(has_exact_tech('gateway',2) && get_building_count('galaxy','starbase')<1 && build_structure(['galaxy-starbase'])) return true;
		if(has_tech('gateway',3) && build_early_stargate()) return true;
		// second contact i guess after we have some bolognium techs
		// (hydroponics, alloy beams, shield generator)
		if(has_exact_tech('xeno',2) && has_tech('infernite',5) && build_structure(['galaxy-gorddon_mission'])) return true;
		return build_crates();
	}
	if(has_exact_tech('xeno',4)) {
		console.log('focus embassy');
		// embassy in its own phase i guess
		interstellar_manage_population('Wrought_Iron');
		andromeda_replicator_management();
		if(has_exact_tech('xeno',4) && build_structure(['galaxy-embassy'])) return true;
		return build_crates();
	}
	if(has_tech('xeno',5) && !has_tech('chthonian',2)) {
		// post-embassy
		console.log('after embassy');
		if(get_resource('Mythril').amount<500000) interstellar_manage_population('Mythril');
		else if(has_tech('nanoweave',1) && get_resource('Nanoweave').amount<500000) interstellar_manage_population('Nanoweave');
		else if(has_exact_tech('xeno',10) && get_resource('Sheet_Metal').amount<1100000 && get_building_count('galaxy','frigate_ship')<2) interstellar_manage_population('Sheet_Metal');
		else if(get_resource('Mythril').amount<2500000) interstellar_manage_population('Mythril');
		else interstellar_manage_population('Wrought_Iron');
		andromeda_replicator_management();
		set_factory_production_percent_check_cap(['Furs',12,'Alloy',22,'Polymer',22,'Stanene',22,'Nano',22]);
		// arpa project in progress: finish it before anything else
		if(bioseed_build_on_red_planet()) return true;
		if(bioseed_build_on_moon()) return true;
		if(interstellar_buildings_we_always_want()) return true;
		if(earth_buildings_we_always_want()) return true;
		if(interstellar_build_on_alpha_centauri()) return true;
		if(interstellar_build_on_helix_nebula_all()) return true;
		// TODO set smelter to 5 iron, 5 iridium, the rest steel
		// TODO build supercolliders whenever we can afford everything except knowledge
		// if morale is capped, build monument if we can afford it at once
		if(evolve.global.city.morale.potential>evolve.global.city.morale.current) {
			let low=can_afford_arpa('monument');
			if(low==100 && build_arpa_project('monument')) return true;
		}
		if(build_structure(['interstellar-mass_ejector'])) return true;
		// build storage for capped buildings
		if(build_storage_if_capped(MAD_capped_list.union(bioseed_capped_list).union(interstellar_capped_list))) return true;
		if(interstellar_build_on_belt()) return true;
		if(build_supercollider_minus_knowledge()) return true;
		if(andromeda_build_gorddon()) return true;
		if(!has_tech('conflict',1) && build_early_stargate()) return true;
		if(has_tech('dyson',1)) {
			let low=can_afford_arpa('roid_eject');
			if(low==100 && build_arpa_project('roid_eject')) return true;
			if(research_given_techs(new Set(['bolognium_crates','bolognium_containers','bolognium_vaults']))) return true;
		}
		// after metaphysics, build a few war droids and more repair droids
		if(has_tech('high_tech',16)) {
			if(get_building_count('portal','war_droid')<4 && build_structure(['portal-war_droid'])) return true;
			if(get_building_count('portal','repair_droid')<7 && build_structure(['portal-repair_droid'])) return true;
		}
		// build 1 freighter
		if(get_building_count('galaxy','freighter')<1 && build_structure(['galaxy-freighter'])) return true;
		// then turn it off
		if(get_building_count('galaxy','freighter')==1) disable_building('galaxy-freighter');
		// build 100 defense in stargate asap
		if(get_building_count('galaxy','defense_platform')<5 && build_structure(['galaxy-defense_platform'])) return true;
		// build 100 defense in gateway system if we don't already have it
		if(get_building_count('galaxy','starbase')<4 && build_structure(['galaxy-starbase'])) return true;
		// build some stellar forges because iridium production sucks
		if(get_building_count('interstellar','stellar_forge')<10 && build_structure(['interstellar-stellar_forge'])) return true;
		if(has_exact_tech('xeno',7)) {
			if(research_given_techs(new Set(['xeno_gift']))) return true;
		}
		if(has_tech('xeno',8) && !has_tech('conflict',1)) {
			if(get_building_count('galaxy','consulate')<1 && build_structure(['galaxy-consulate'])) return true;
			// build up to 250 defense in both gateway and stargate
			// TODO build depots if we are capped
			if(get_building_count('galaxy','defense_platform')<13 && build_structure(['galaxy-defense_platform'])) return true;
			if(get_building_count('galaxy','starbase')<10 && build_structure(['galaxy-starbase'])) return true;
		}
		// force bolognium dyson sphere to be done by this time
		if(has_tech('xeno',8) && !has_tech('conflict',1) && get_building_count('interstellar','dyson_sphere')==100) {
			if(get_building_count('galaxy','consulate')<1 && build_structure(['galaxy-consulate'])) return true;
			// build up to 250 defense in both gateway and stargate
			// build depots if we are capped
			if(get_building_count('galaxy','defense_platform')<13 && !can_afford_at_max('galaxy','defense_platform','gxy_stargate') && build_structure(['galaxy-gateway_depot'])) return true;
			if(get_building_count('galaxy','defense_platform')<13 && build_structure(['galaxy-defense_platform'])) return true;
			if(get_building_count('galaxy','starbase')<10 && build_structure(['galaxy-starbase'])) return true;
			// don't continue until we're defended
			if(get_building_count('galaxy','defense_platform')>=13 && get_building_count('galaxy','starbase')>=10) {
			// build 2 frigates and 1 cruiser
			// build support as needed
				if(get_building_count('galaxy','frigate_ship')<2) {
					if(evolve.global.galaxy.starbase.support+2>evolve.global.galaxy.starbase.s_max) {
						if(build_structure(['galaxy-telemetry_beacon','galaxy-starbase'])) return true;
					} else {
						if(build_structure(['galaxy-frigate_ship'])) return true;
					}
				}
				if(get_building_count('galaxy','cruiser_ship')<1) {
					if(evolve.global.galaxy.starbase.support+3>evolve.global.galaxy.starbase.s_max) {
						if(build_structure(['galaxy-telemetry_beacon','galaxy-starbase'])) return true;
					} else {
						if(build_structure(['galaxy-cruiser_ship'])) return true;
					}
				}
				// when the ships are built, send them to alien2
				if(has_tech('andromeda',4) && !has_tech('conflict',1) && get_building_count('galaxy','frigate_ship')>=2 && get_building_count('galaxy','cruiser_ship')>=1 && get_building_count('galaxy','starbase')>=10 && get_building_count('galaxy','defense_platform')>=13) {
					let frig1=evolve.global.galaxy.defense.gxy_gateway.frigate_ship;
					let frig2=evolve.global.galaxy.defense.gxy_alien2.frigate_ship;
					let cru1=evolve.global.galaxy.defense.gxy_gateway.cruiser_ship;
					let cru2=evolve.global.galaxy.defense.gxy_alien2.cruiser_ship;
					if(frig2<2 || cru2<1) {
						// move the ships to alien2
						if(frig1+frig2<2) console.log('sanity error, missing frigate');
						if(cru1+cru2<1) console.log('sanity error, missing cruiser');
						while(frig2<2) andromeda_add_ship(4,2),frig2++;
						while(cru2<2) andromeda_add_ship(4,3),cru2++;
						return true;
					} else {
						// ships are in place, commence assault
						if(build_structure(['galaxy-alien2_mission'])) return true;
					}
				}
			}
			// then put the cruiser in stargate to 0 it
			// send the rest to gateway to 0 bolognium production
		}
		if(has_tech('conflict',1)) {
			if(get_building_count('galaxy','defense_platform')<13 && build_structure(['galaxy-defense_platform'])) return true;
			if(get_building_count('galaxy','starbase')<18 && !can_afford_at_max('galaxy','starbase','gxy_gateway') && build_structure(['galaxy-gateway_depot'])) return true;
			if(get_building_count('galaxy','starbase')<18 && build_structure(['galaxy-starbase'])) return true;
			// move cruiser ship to stargate
			if(evolve.global.galaxy.defense.gxy_stargate.cruiser_ship==0) {
				if(evolve.global.galaxy.defense.gxy_gateway.cruiser_ship==0) {
					// move cruiser from alien2 to gateway
					andromeda_remove_ship(4,3);
					return true;
				} else {
					// move cruiser from gateway to stargate
					andromeda_add_ship(1,3);
				}
			}
			// build stuff in alien2, max 1 armed mining ship for now
			// (bolognium production sucks until we get a dreadnought)
			if(andromeda_build_alien2(1)) return true;
			if(get_building_count('galaxy','dreadnought')<1) {
				if(build_structure(['galaxy-dreadnought'])) return true;
			} else if(get_building_count('galaxy','dreadnought')==1) {
				// move dreadnought to alien2
				if(evolve.global.galaxy.defense.gxy_gateway.dreadnought>0 && evolve.global.galaxy.defense.gxy_alien2.dreadnought==0) {
					andromeda_add_ship(4,4);
					return true;
				}
				if(evolve.global.galaxy.defense.gxy_alien2.dreadnought>0) {
					// we have a dreadnought in alien2, start building some armed mining ships
					if(andromeda_build_alien2(5)) return true;
					if(get_building_count('galaxy','armed_miner')>=5) {
						// we have a few armed mining ships, depopulate bolognium ships
						let onoff=get_enabled_disabled('galaxy-bolognium_ship');
						while(onoff[0]>0) disable_building('galaxy-bolognium_ship'),onoff[0]--;
					}
				}
				if(build_structure(['galaxy-dreadnought'])) return true;
			} else {
				if(andromeda_build_alien2(5)) return true;
				// we have 2 dreadnoughts, send one to chthonian
				if(evolve.global.galaxy.defense.gxy_gateway.dreadnought==1) {
					andromeda_add_ship(5,4);
					return true;
				} else {
					// chthonian assault
					return build_structure(['galaxy-chthonian_mission']);
				}
			}
		}
		return build_crates();
	}
	// chthonian assault done
	if(true) {
		console.log('after chthonian');
		if(get_resource('Mythril').amount<500000) interstellar_manage_population('Mythril');
		else if(has_tech('nanoweave',1) && get_resource('Nanoweave').amount<500000) interstellar_manage_population('Nanoweave');
		else if(has_exact_tech('xeno',10) && get_resource('Sheet_Metal').amount<1100000 && get_building_count('galaxy','frigate_ship')<2) interstellar_manage_population('Sheet_Metal');
		else interstellar_manage_population('Wrought_Iron');
		andromeda_replicator_management();
		set_factory_production_percent_check_cap(['Furs',12,'Alloy',22,'Polymer',22,'Stanene',22,'Nano',22]);
		// arpa project in progress: finish it before anything else
		if(bioseed_build_on_red_planet()) return true;
		if(bioseed_build_on_moon()) return true;
		if(interstellar_buildings_we_always_want()) return true;
		if(earth_buildings_we_always_want()) return true;
		if(interstellar_build_on_alpha_centauri()) return true;
		if(interstellar_build_on_helix_nebula_all()) return true;
		if(get_building_count('galaxy','defense_platform')<13 && build_structure(['galaxy-defense_platform'])) return true;
		if(get_building_count('galaxy','starbase')<10 && build_structure(['galaxy-starbase'])) return true;
		// TODO set smelter to 5 iron, 5 iridium, the rest steel
		// TODO build supercolliders whenever we can afford everything except knowledge
		// if morale is capped, build monument if we can afford it at once
		if(evolve.global.city.morale.potential>evolve.global.city.morale.current) {
			let low=can_afford_arpa('monument');
			if(low==100 && build_arpa_project('monument')) return true;
		}
		if(build_structure(['interstellar-mass_ejector'])) return true;
		// build storage for capped buildings
		if(build_storage_if_capped(MAD_capped_list.union(bioseed_capped_list).union(interstellar_capped_list))) return true;
		if(interstellar_build_on_belt()) return true;
		if(build_supercollider_minus_knowledge()) return true;
		if(andromeda_build_gorddon()) return true;
		if(has_tech('dyson',1)) {
			let low=can_afford_arpa('roid_eject');
			if(low==100 && build_arpa_project('roid_eject')) return true;
			if(research_given_techs(new Set(['bolognium_crates','bolognium_containers','bolognium_vaults']))) return true;
		}
		if(andromeda_build_alien2(10)) return true;
		if(andromeda_build_chthonian()) return true;
		// build some more hell droids
		if(get_building_count('portal','war_droid')<10 && build_structure(['portal-war_droid'])) return true;
		if(get_building_count('portal','repair_droid')<15 && build_structure(['portal-repair_droid'])) return true;
		// build some more dreadnoughts, but only if we already can fill some jobs
		if(get_building_count('galaxy','dreadnought')<3 && !has_free_worker_slots(['cement_worker','craftsman'])) {
			// check support
			let cur=evolve.global.galaxy.starbase.support;
			let max=evolve.global.galaxy.starbase.s_max;
			if(cur+5>max) {
				if(build_structure(['galaxy-starbase'])) return true;
			} else {
				if(build_structure(['galaxy-dreadnought'])) return true;
			}
		}
		// send dreadnoughts to chthonian
		if(evolve.global.galaxy.defense.gxy_gateway.dreadnought>0) {
			andromeda_add_ship(5,4);
			return true;
		}
		if(has_tech('mass',2) && build_structure(['city-mass_driver'])) return true;
		return build_crates();
	}
	return false;
}

// takes over after ascension_early (we have 2 dreadnoughts in chthonian)
// either goes straight for ascension or does pillaring, depending on reset_type
function ascend_main(reset_type) {
	if(handle_modals()) return true;
	if(set_default_job(['quarry_worker','lumberjack','scavenger'])) return true;
	MAD_set_nanite_input();
	interstellar_trade_route_management();
	pylon_management(80);
	interstellar_buy_minor_traits();
	if(synth_management()) return true;
	if(slaver_management()) return true;
	tax_morale_balance(20,55);
	matter_replicator_management();
	mining_droid_management();
	if(build_shrine()) return true;
	if(finish_unfinished_arpa_project()) true;
	if(interstellar_hell_management('ascension')) return true;
	andromeda_set_smelter();
	if(earth_buildings_we_always_want()) return true;
	if(bioseed_build_on_red_planet()) return true;
	if(bioseed_build_on_moon()) return true;
	if(interstellar_buildings_we_always_want()) return true;
	if(earth_buildings_we_always_want()) return true;
	if(interstellar_build_on_alpha_centauri()) return true;
	if(has_tech('mass',2) && build_structure(['city-mass_driver'])) return true;
	if(reset_type=='pillar' && !has_tech('ascension',1)) {
		console.log('pillar');
		let scarlet=0;
		if(get_building_count('portal','archaeology')<1) interstellar_manage_population('Mythril');
		if(get_resource('Mythril').amount<1200000) interstellar_manage_population('Mythril');
		else interstellar_manage_population('Brick');
		if(get_resource('Nanoweave').amount<100000) matter_replicator_management('Nanoweave');
		else if(get_resource('Aerogel').amount<1000000) matter_replicator_management('Aerogel');
		else if(get_resource('Vitreloy').amount<100000) matter_replicator_management('Vitreloy');
		else if(get_resource('Sheet_Metal').amount<1000000) matter_replicator_management('Sheet_Metal');
		else if(get_resource('Aerogel').amount<5000000) matter_replicator_management('Aerogel');
		else if(get_resource('Nanoweave').amount<5000000) matter_replicator_management('Nanoweave');
		else if(get_resource('Vitreloy').amount<5000000) matter_replicator_management('Vitreloy');
		else if(has_tech('scarletite',1)) matter_replicator_management('Scarletite'),scarlet=1;
		else matter_replicator_management('Brick');
		if(has_exact_tech('hell_ruins',1) && build_structure(['portal-ruins_mission'])) return true;
		if(research_given_techs(new Set(['stabilize_blackhole','zoo','codex_infernium','arcology','scarletite','infernium_fuel','cybernetics','infernium_power','pillars','advanced_biotech','cyber_limbs','orichalcum_sphere','cyborg_soldiers','gate_key','gate_turret','infernite_mine']))) return true;
		// build guard posts
		set_factory_production_percent_check_cap(['Furs',12,'Alloy',22,'Polymer',22,'Stanene',22,'Nano',22]);
		if(has_tech('hell_ruins',2)) {
			// can't easily get suppression, just wing it. maybe lower it
			if(get_building_count('portal','guard_post')<80 && build_structure(['portal-guard_post'])) return true;
			if(build_one(['portal-archaeology'])) return true;
		}
		if(has_tech('hell_vault',1) && !has_tech('hell_ruins',3)) {
			if(build_structure(['portal-vault'])) return true;
		}
		if(has_tech('hell_ruins',4)) {
			if(!can_afford_at_max('galaxy','scavenger','gxy_alien2') && build_structure(['galaxy-gateway_depot'])) return true;
			if(andromeda_build_alien2(20)) return true;
			if(build_structure(['portal-hell_forge','portal-inferno_power'])) return true;
		}
		// build arcologies if we have a lot of orichalcum
		if(get_resource('Orichalcum').amount>30000000 && build_structure(['portal-arcology'])) return true;
		// build dreadnoughts after vault v1
		if(has_tech('hell_vault',1) && get_building_count('portal','vault')>=1 && get_building_count('galaxy','dreadnought')<5 && !has_free_worker_slots(['cement_worker','craftsman'])) {
			// check support
			let cur=evolve.global.galaxy.starbase.support;
			let max=evolve.global.galaxy.starbase.s_max;
			if(cur+5>max) {
				if(build_structure(['galaxy-starbase','galaxy-telemetry_beacon','galaxy-gateway_station'])) return true;
			} else {
				if(build_structure(['galaxy-dreadnought'])) return true;
			}
		}
		if(has_exact_tech('high_tech',18) && build_structure(['portal-gate_mission'])) return true;
		// send dreadnoughts to chthonian
		if(evolve.global.galaxy.defense.gxy_gateway.dreadnought>0) {
			andromeda_add_ship(5,4);
			return true;
		}
		if(get_building_count('interstellar','citadel')<5 && build_structure(['interstellar-citadel'])) return true;
		if(andromeda_build_alien2(10)) return true;
		if(andromeda_build_chthonian()) return true;
		if(build_structure(['galaxy-dormitory','galaxy-telemetry_beacon'])) return true;
		if(build_structure(['interstellar-zoo'])) return true;
		if(build_supercollider_minus_knowledge()) return true;
		if(get_building_count('interstellar','luxury_condo')<10 && build_structure(['interstellar-luxury_condo'])) return true;
		// if we pillar, stall in this routine until we're close to pillaring
		// wing it again
		if(get_building_count('portal','hell_forge',8) && scarlet==1) {
			if(research_given_techs(new Set(['incorporeal']))) return true;
		}
		// if we already pillared the race but chose to pillar for some reason:
		// researching scarletite is enough
		let val=evolve.global.pillars[evolve.global.race.species];
		if(val!=undefined && has_tech('scarletite',1)) {
			if(research_given_techs(new Set(['incorporeal']))) return true;
		}
		build_swarm_satellites();
		return build_crates();
	}
	console.log('very close to ascension');
	if(get_resource('Aerogel').amount<5000000) matter_replicator_management('Aerogel');
	else if(get_resource('Nanoweave').amount<5000000) matter_replicator_management('Nanoweave');
	else if(get_resource('Vitreloy').amount<5000000) matter_replicator_management('Vitreloy');
	else if(has_tech('scarletite',1)) matter_replicator_management('Scarletite');
	else matter_replicator_management('Brick');
	if(has_exact_tech('ascension',4)) interstellar_manage_population('Mythril');
	else interstellar_manage_population('Brick');
	set_factory_production_percent_check_cap(['Furs',5,'Alloy',5,'Polymer',5,'Stanene',80,'Nano',5]);

	// build some more citadel stations
	if(get_building_count('interstellar','citadel')<5 && build_structure(['interstellar-citadel'])) return true;

	if(research_given_techs(new Set(['incorporeal','tech_ascension','stabilize_blackhole']))) return true;
	// build up to 5 dreadnoughts
	if(get_building_count('galaxy','dreadnought')<5 && !has_free_worker_slots(['cement_worker','craftsman'])) {
		// check support
		let cur=evolve.global.galaxy.starbase.support;
		let max=evolve.global.galaxy.starbase.s_max;
		if(cur+5>max) {
			if(build_structure(['galaxy-starbase'])) return true;
		} else {
			if(build_structure(['galaxy-dreadnought'])) return true;
		}
	}
	// send dreadnoughts to chthonian
	if(evolve.global.galaxy.defense.gxy_gateway.dreadnought>0) {
		andromeda_add_ship(5,4);
		return true;
	}
	// TODO turn off minelayers when we exceed 7500 defense in chthonian
	// ascension stuff
	if(has_exact_tech('ascension',2) && build_structure(['interstellar-sirius_mission'])) return true;
	if(has_exact_tech('ascension',3) && build_structure(['interstellar-sirius_b'])) return true;
	if(has_exact_tech('ascension',4)) {
		if(build_big_structure('interstellar-space_elevator',100)) return true;
	}
	if(has_exact_tech('ascension',5)) {
		if(build_big_structure('interstellar-gravity_dome',100)) return true;
	}
	if(has_tech('ascension',6)) {
		if(get_building_count('interstellar','thermal_collector')<67 && build_structure(['interstellar-thermal_collector'])) return true;
		if(build_big_structure('interstellar-ascension_machine',99)) return true;
	}
	if(build_structure(['portal-ancient_pillars'])) return true;
	if(get_resource('Orichalcum').amount>30000000) {
		if(research_given_techs(new Set(['orichalcum_sphere']))) return true;
		if(has_tech('dyson',2) && build_big_structure('interstellar-orichalcum_sphere',100)) return true;
	}
	// build swarm satellites i guess (lowest pri since i build one at a time)
	if(build_swarm_satellites()) return true;
	return build_crates();
}

function pillar_bot() {
	// if we're in a scenario, just call the correct bot
	if(evolve.global.race.hasOwnProperty('warlord')) return warlord_bot();
	if(evolve.global.race.hasOwnProperty('lone_survivor')) return lone_survivor_bot();
	if(!has_tech('mad',1)) MAD_main('sports');
	else if(!has_tech('genesis',3) || !has_tech('high_tech',11)) bioseed_main();
	else if(!has_tech('blackhole',4) || get_building_count('interstellar','mass_ejector')<2) interstellar_main('ascension');
	else if(!has_tech('chthonian',2) || evolve.global.galaxy.defense.gxy_chthonian.dreadnought<2) andromeda_early_main();
 	else ascend_main('pillar');
}

function ascend_bot() {
	// if we're in a scenario, just call the correct bot
	if(evolve.global.race.hasOwnProperty('warlord')) return warlord_bot();
	if(evolve.global.race.hasOwnProperty('lone_survivor')) return lone_survivor_bot();
	if(!has_tech('mad',1)) MAD_main('sports');
	else if(!has_tech('genesis',3) || !has_tech('high_tech',11)) bioseed_main();
	else if(!has_tech('blackhole',4) || get_building_count('interstellar','mass_ejector')<2) interstellar_main('ascension');
	else if(!has_tech('chthonian',2) || evolve.global.galaxy.defense.gxy_chthonian.dreadnought<2) andromeda_early_main();
	else ascend_main('ascension');
}

//--------------------------
// code for edenic territory
//--------------------------

// elysium fields, celestial fortress
// this part sucks combined with a high number of attractor beacons
// where we can barely sustain peacekeepers
// i guess we just turn off attractor beacons and autohire mercs
// and then keep bashing at the fortress
// order:
// - ambush patrol down to 18 for tech
// - raid supplies down to 99% readiness for another tech
// - ambush patrol down to 15 + raid supplies down to 80% for another tech
// - then 0 patrols -> 0% readiness -> whack fortress
// * build lots of asphodel bunkers, they are locked behind one of the above
//   techs (forgot which). should triple our soldier training speed or so
// * desperately buy boot camps and temples (zealotry) during this
// * arpa->genetics->tactical should already be as high as we can get it
// turn on attractor beacons, turn off autohire mercs when done
// during the above sction, don't spend soul gems. we want to save up for the
// upcoming 5000 soul gems

//---------------------------------
// code for ai apocalypse territory
//---------------------------------

// very bottleneck-heavy, optimize around it
// - sheet metal for forward base
// - mass relay
// - charge up mass relay
// - send fastest corvettes to eris, enough to scan
// - send big ships to kuiper and triton to have non-shitty production

//---------------------------------------------------
// code for lone survivor, farming runs in antimatter
//---------------------------------------------------

// use a custom with smart (mandatory), intelligent, lawless,
// production and mining buffs and a bunch of garbage
// traits that don't have an effect here
// the script utilizes wish (useful),
// ocular powers (hard labor jobs +15% is good i guess) 
// don't take ravenous, please don't take unorganized
// use a trashed planet
// please play in antimatter, or we will have serious power issues
// (which the script doesn't mitigate. TODO mitigate)

// antimatter times:
// script finishes in 967 days on extreme progression
// 10580 days on my progression with a general tp4 custom (not particularly suitable)
// 4827 days with a heat custom with tusked, empowered r2, lawless r2
// inherit wish and ocular powers (compare with 2x wish)
// 4920 days with inherit wish and empowered

// discord recommends synthetic, but that either requires A LOT more spatial
// than i have (i'm at 116k plasmids, 47k anti-plasmids, 8.7k phage, 38 pillars)
// or another method than contact for womlings. introduction is bad because it
// costs titanium which is slow. TODO check if subjugate is viable

// i guess there are 2 sets of fanaticism and antropology depending on transcendence?
// only tested with transcendence 2
let LS_researches_1=new Set(['fanaticism','alt_fanaticism','alt_anthropology','replicator','outpost_boost','minor_wish','governor','ancient_theology','major_wish','deify','deify_alt']);
let LS_researches_2=new Set(['tau_cultivation','tau_manufacturing']);
let LS_researches_3=new Set(['iso_gambling','cultural_center']);
let LS_researches_3a=new Set(['womling_unlock']);
let LS_researches_4=new Set(['womling_fun','womling_lab']);
let LS_researches_5=new Set(['system_survey','asteroid_analysis','shark_repellent','belt_mining','adv_belt_mining','outer_tau_survey']);
let LS_researches_6=new Set(['alien_research','womling_gene_therapy','food_culture','womling_mining','advanced_refinery','advanced_pit_mining','womling_firstaid','advanced_asteroid_mining']);
let LS_researches_7=new Set(['garden_of_eden']);

/* useless techs (i think):
mythology -> archaeology -> merchandising
indoctrination -> missionary -> zealotry
study ancients -> genetic encoding (boosts exo labs, useless?)
genetic infusion (boosts ziggurats, useless)
lodge, windmill
space whaling (can replicate oil when close to 0)
womling logistics (comes too late)
advanced material synthesis (no need to actually produce quantium)
*/

// script is largely based on a build order image found on discord by rxdg

function LS_minor_wish_for_fame() {
	if(!has_trait('wish') || !can_minor_wish()) return false;
	let wish=get_wish_struct();
	// minor wish until we have 10% fame
	if(wish.fame!=10) {
		make_minor_wish('famous');
		return true;
	}
	return false;
}

function LS_build_initial_monuments() {
	// get cost: [resource,amount]
	let cost=get_cost_of_next_monument();
	// stop as soon as the next monument would leave us with too little storage
	if(cost[0]=='Steel') {
		if(get_resource('Steel').amount-cost[1]>3000000) return build_arpa_project('monument');
	} else if(cost[0]=='Cement') {
		if(resource_exists('Cement') && get_resource('Cement').amount-cost[1]>2000000) return build_arpa_project('monument');
	} else if(cost[0]=='Stone') {
		if(resource_exists('Stone') && get_resource('Stone').amount-cost[1]>2000000) return build_arpa_project('monument');
	} else if(cost[0]=='Chrysotile') {
		if(resource_exists('Chrysotile') && get_resource('Chrysotile').amount-cost[1]>2000000) return build_arpa_project('monument');
	} else if(can_afford_arpa('monument')==100) return build_arpa_project('monument');
	return false;
}

function LS_clay_monuments() {
	// get cost: [resource,amount]
	let cost=get_cost_of_next_monument();
	if(cost[0]=='Stone' && can_afford_arpa('monument')==100) return build_arpa_project('monument');
	return false;
}

// return our current job as a string
// TODO make sure it can return our current crafting job
// probably in evolve.global.city.foundry
function LS_get_guy() {
	for(let job in evolve.global.civic) if(evolve.global.civic[job].hasOwnProperty('job')) {
		let e=evolve.global.civic[job];
		if(e.workers==1) return e.job;
	}
	return null;
}

function LS_set_job(job,amount) {
	if(amount!=0 && amount!=1) console.log('sanity error, not 0 or 1');
	let q=document.getElementById('civ-'+job);
	if(q==null) {
		// job not found as normal job, look at crafters
		q=document.getElementById('craft'+job);
		if(q==null) console.log('LS_set_job sanity error, no job');
		q.nextSibling().childNodes[amount].click();
	}
	q.childNodes[1].childNodes[amount].click();
}

// set new job
function LS_set_guy(job) {
	let previous=LS_get_guy();
	if(previous==job) return;
	LS_set_job(previous,0);
	LS_set_job(job,1);
}

function ls_build_tauceti_phase1() {
	let cur=evolve.global.tauceti.orbital_station.support;
	let max=evolve.global.tauceti.orbital_station.s_max;
	// more power issues outside of antimatter
	if(evolve.global.race.universe!='antimatter' && LS_num('orbital_station')==3 && LS_num('fusion_generator')<2) {
		return build_structure(['fusion_generator']);
	}
	if(cur>=max-1 && LS_num('orbital_station')<5) return build_structure(['tauceti-orbital_station']);
	if(LS_num('colony')<7) return build_structure(['tauceti-colony']);
	return false;
}

function ls_build_tauceti_phase2() {
	let cur=evolve.global.tauceti.orbital_station.support;
	let max=evolve.global.tauceti.orbital_station.s_max;
	if(cur>=max && LS_num('orbital_station')<6) return build_structure(['tauceti-orbital_station']);
	if(LS_num('tau_factory')<3)	return build_structure(['tauceti-tau_factory']);
	return false;
}

function ls_build_tauceti_phase3() {
	let cur=evolve.global.tauceti.orbital_station.support;
	let max=evolve.global.tauceti.orbital_station.s_max;
	if(cur>=max-1) {
		if(LS_num('orbital_station')<8 && build_structure(['tauceti-orbital_station'])) return true;
		if(LS_num('tau_farm')<1 && build_structure(['tauceti-tau_farm'])) return true;
	}
	if(cur<max-1 && LS_num('colony')<10 && build_structure(['tauceti-colony'])) return true;
	if(cur<max && LS_num('infectious_disease_lab')<1 && build_structure(['tauceti-infectious_disease_lab'])) return true;
	return false;
}

// casinos need only furs
// infectious disease lab wants 8.5m alloy and 12-13m polymer
// cultural centers need only polymer
function LS_set_factory_phase2() {
	let n=get_num_factory_production_lines();
	if(LS_num('tauceti_casino')<12 || LS_num('colony')<10) set_factory_production(['Furs',n]);
	else if(LS_num('infectious_disease_lab')<1 && get_resource('Alloy').amount<9600000) set_factory_production(['Alloy',n]);
	else set_factory_production(['Polymer',n]);
}

function LS_set_factory_phase3() {
	let n=get_num_factory_production_lines();
	if(get_resource('Furs').amount<9000000 && LS_num('tauceti_casino')<17) set_factory_production(['Furs',n]);
	else if(get_resource('Alloy').amount<10000000) set_factory_production(['Alloy',n]);
	else set_factory_production(['Polymer',n]);
}

function LS_set_factory_phase4() {
	set_factory_production_percent_check_cap(['Alloy',2,'Polymer',49,'Stanene',49]);
}

function LS_set_factory_phase5() {
	set_factory_production_percent_check_cap(['Alloy',1,'Nano',99]);
}

function LS_set_factory_phase6() {
	set_factory_production_percent_check_cap(['Alloy',4,'Nano',48,'Stanene',48]);
}

function LS_set_factory_res(res) {
	let n=get_num_factory_production_lines();
	set_factory_production([res,n]);
}

function LS_womling_phase1() {
	let cur=evolve.global.tauceti.orbital_platform.support;
	let max=evolve.global.tauceti.orbital_platform.s_max;
	if(cur>=max) {
		if(LS_num('orbital_platform')<8 && build_structure(['tauceti-orbital_platform'])) return true;
		return false;
	}
	if(LS_num('womling_farm')<5 && build_structure(['tauceti-womling_farm'])) return true;
	if(LS_num('womling_mine')<6 && build_structure(['tauceti-womling_mine'])) return true;
	if(LS_num('womling_village')<10 && build_structure(['tauceti-womling_village'])) return true;
	if(evolve.global.race.womling_friend==1) {
		if(LS_num('womling_fun')<3 && build_structure(['tauceti-womling_fun'])) return true;
		if(LS_num('overseer')<6 && build_structure(['tauceti-overseer'])) return true;
	} else if(evolve.global.race.womling_god==1) {
		if(LS_num('womling_fun')<5 && build_structure(['tauceti-womling_fun'])) return true;
		if(LS_num('overseer')<4 && build_structure(['tauceti-overseer'])) return true;
	} else if(evolve.global.race.womling_lord==1) {
		if(LS_num('womling_fun')<3 && build_structure(['tauceti-womling_fun'])) return true;
		if(LS_num('overseer')<6 && build_structure(['tauceti-overseer'])) return true;
	}
	return false;
}

// TODO have the number of buildings in just one place
// currently they're repeated in the function above
// true if we don't have the desired number of morale+loyalty buildings
function LS_womling_loyalty_morale() {
	if(evolve.global.race.womling_friend==1) {
		return LS_num('womling_fun')<3 || LS_num('overseer')<6;
	} else if(evolve.global.race.womling_god==1) {
		return LS_num('womling_fun')<5 || LS_num('overseer')<4;
	} else if(evolve.global.race.womling_lord==1) {
		// TODO adjust these numbers
		return LS_num('womling_fun')<3 || LS_num('overseer')<6;
	}
	// no contact with womlings: automatically true
	return true;
}

// build monument when we're morale-capped
// or build if it costs a resource that's capped
// building when morale isn't capped only earns more money which probably isn't
// so useful
// only call after we've built the last thing that costs steel (womling mines)
function LS_late_monuments() {
	if(evolve.global.city.morale.potential>evolve.global.city.morale.current) {
		let low=can_afford_arpa('monument');
		if(low==100 && build_arpa_project('monument')) return true;
	} else {
		let cost=get_cost_of_next_monument();
		if(get_resource(cost[0]).amount>get_resource(cost[0]).max*0.99 && build_arpa_project('monument')) return true;
	}
	return false;
}

function lone_survivor_bot() {
	if(evolve.global.race.hasOwnProperty('warlord')) return warlord_bot();
	if(!evolve.global.race.hasOwnProperty('lone_survivor')) {
		console.log('ERROR, attempted to run lone survivor script outside of scenario');
		return;
	}
	// lower power buffer, power is typically not fluctuating
	settings.replicator_power_buffer=2;
	// TODO turn off gene sequencing
	if(handle_modals()) return;
	matter_replicator_management();
	// our guy is a banker and wish is available: with for money
	if(has_trait('wish') && has_tech('wish',2) && can_major_wish() && evolve.global.civic.banker.max>0 && evolve.global.civic.banker.workers==1) {
		make_major_wish('money');
		return;
	}
	if(has_trait('wish') && has_tech('wish',1) && can_minor_wish() && evolve.global.civic.banker.max>0 && evolve.global.civic.banker.workers==1) {
		make_minor_wish('money');
		return;
	}
	if(!has_tech('fanaticism',1)) {
		// set some stuff at the very beginning
		if(MAD_change_government('anarchy','technocracy')) return;
		set_tax_percent(0);
		// professor during the initial techs
		LS_set_guy('professor');
	}
	// trait name is misspelled in the game variables
	// TODO this doesn't distinguish between the initial structure (if there is
	// one, i dunno) or building a person, and doesn't check whether we can afford
	if(has_trait('artifical') && get_population()<get_max_population()) {
		return build_structure(['tauceti-assembly']);
	}
	set_ocular_power(['t','c','w']);
	// assign these every call in case they get changed
	if(evolve.global.race.hasOwnProperty('servants')) {
		// all servants in scavenger if we can
		let job='';
		if(evolve.global.civic.scavenger.display) job='servant-scavenger';
		else if(evolve.global.civic.quarry_worker.display) job='servant-quarry_worker';
		else if(evolve.global.civic.crystal_miner.display) job='servant-crystal_miner';
		else if(evolve.global.civic.forager.display) job='servant-forager';
		else if(evolve.global.civic.farmer.display) job='servant-farmer';
		else if(evolve.global.civic.lumberjack.display) job='servant-lumberjack';
		else console.log('i give up, no job for servants');
		assign_jobs_percent(document.getElementById('servants'),[job,100],evolve.global.race.servants.max);
		// all skilled servants on wrought iron
		// removed, we start with enough
		// we also avoid the error when skilled servants don't show up
//		assign_jobs_percent(document.getElementById('skilledServants'),['scraftWrought_Iron',100],evolve.global.race.servants.smax);
	}
	if(has_trait('shapeshifter') && get_mimic()=='none' && set_mimic(['heat','avian','plant','small'])) return;
	if(set_governor('bureaucrat')) return;
	if(set_governor_task('bal_storage')) return;
	// crate manager: 4x alloy and polymer
	if(set_crate_manager(['Food',4,'Alloy',4,'Polymer',4])) return true;
	if(LS_minor_wish_for_fame()) return;
	// major wish for money if we are somewhat low on money (half of cap)
	// but at most 500M
	if(has_trait('wish') && can_major_wish() && evolve.global.civic.banker.max>0 && evolve.global.civic.banker.workers==0 && get_resource('Money').amount<5e8 && get_resource('Money').amount<get_resource('Money').max*0.55) {
		// setting guy to banker and available wish is the cue for wishing for money
		LS_set_guy('banker');
		return;
	} else if(has_trait('wish') && can_major_wish()) {
		// if money is good, wish for resources
		// in my last (very slow) run i never had money problems
		make_major_wish('res');
		return;
	}
	// whenever minor wish is available and we have 10% fame: resources i guess
	// TODO if we're low on tech and are researching something wish for knowledge could be good
	if(has_trait('wish') && can_minor_wish() && get_wish_struct().fame==10) {
		if(evolve.global.civic.banker.workers==0 && get_resource('Money').amount<5e8 && get_resource('Money').amount<get_resource('Money').max*0.55) {
			LS_set_guy('banker');
			return;
		} else {
			make_minor_wish('res');
			return;
		}
	}
	// initial techs
	if(!has_tech('outpost_boost',1)) {
		// build monuments, don't go below 3 mill steel
		if(LS_build_initial_monuments()) return;
		// set matter replicator to chrysotile
		matter_replicator_management('Chrysotile');
		LS_set_guy('professor');
		if(research_given_techs(LS_researches_1)) return;
//		return build_crates();
		return;
	}
	// build 5 orbital, 7 colony, 12 casino, 2 generator before continuing script
	if(LS_num('orbital_station')<5 || LS_num('colony')<7 || LS_num('tauceti_casino')<12 || LS_num('fusion_generator')<2) {
		if(resource_exists('Cement') && get_resource('Cement').amount<1000000) matter_replicator_management('Cement');
		else matter_replicator_management('Chrysotile');
		LS_set_guy('pit_miner');
		if(LS_num('fusion_generator')<2 && build_structure(['tauceti-fusion_generator'])) return;
		if(LS_num('tauceti_casino')<12 && build_structure(['tauceti-tauceti_casino'])) return;
		ls_build_tauceti_phase1();
		// build crates while stalling
		// or should i? storage doesn't matter a lot
//		return build_crates();
		return;
	}
	// next techs
	if(!has_tech('tau_home',8)) {
		LS_set_guy('professor');
		matter_replicator_management('Chrysotile');
		if(research_given_techs(LS_researches_2)) return;
//		return build_crates();
		return;
	}
	if(LS_num('orbital_station')<6 || LS_num('tau_factory')<3) {
		// corpocracy now i guess, but only if we have the traits to change again soon
		if(get_trait_level('lawless')>=1 && !has_trait('unorganized') && MAD_change_government('technocracy','corpocracy')) return;
		LS_set_factory_phase2();
		LS_set_guy('pit_miner');
		if(LS_num('orbital_station')<6 && get_resource('Helium_3').amount<250000) matter_replicator_management('Helium_3');
		else matter_replicator_management('Chrysotile');
		ls_build_tauceti_phase2();
//		return build_crates();
		return;
	}
	// build 8 orbital, 1 farm, 10 colony, 1 sci lab before continuing script
	// replicate helium until 7 orbital
	if(LS_num('orbital_station')<8 || LS_num('tau_farm')<1 || LS_num('colony')<10 || LS_num('infectious_disease_lab')<1) {
		if(get_trait_level('lawless')>=1 && !has_trait('unorganized') && MAD_change_government('technocracy','corpocracy')) return;
		if(LS_num('orbital_station')<7 || get_resource('Helium_3').amount<300000) matter_replicator_management('Helium_3');
		else if(LS_num('infectious_disease_lab')<1 && get_resource('Unobtainium').amount<17000) matter_replicator_management('Unobtainium');
		else if(LS_num('orbital_station')<8) matter_replicator_management('Helium_3');
		if(resource_exists('Cement') && get_resource('Cement').amount<1000000) LS_set_guy('cement_worker');
		else LS_set_guy('pit_miner');
		LS_set_factory_phase2();
		ls_build_tauceti_phase3();
		// if our caps are too low for science labs, build crates
		// TODO prevent the function from building containers and spending steel
		if(has_tech('disease',1) && !can_afford_at_max('tauceti','infectious_disease_lab','tau_home')) return build_crates();
		return;
	}
	// next set of techs: pit bosses, cultural center, meet the neighbours
	if(!has_tech('tau_culture',1)) {
		if(get_trait_level('lawless')>=1 && !has_trait('unorganized') && MAD_change_government('corpocracy','technocracy')) return;
		matter_replicator_management('Unobtainium');		
		// we have scientists now
		LS_set_guy('scientist');
		LS_set_factory_phase2();
		if(research_given_techs(LS_researches_3)) return;
//		return build_crates();
		return;
	}
	// factories: 9m fur, 10m alloy, then poly
	// 7 cultural
	if(LS_num('tau_cultural_center')<7) {
		// these government changes might be too rapid even with lawless r2
//		if(get_trait_level('lawless')>=1 && !has_trait('unorganized') && MAD_change_government('technocracy','corpocracy')) return;
		matter_replicator_management('Unobtainium');		
		LS_set_guy('pit_miner');
		LS_set_factory_phase2();
		if(build_structure(['tauceti-tau_cultural_center'])) return true;
//		return build_crates();
		return;
	}
	// meet neighbours after cultural center
	if(!has_tech('tau_red',4)) {
//		if(get_trait_level('lawless')>=1 && !has_trait('unorganized') && MAD_change_government('corpocracy','technocracy')) return;
		matter_replicator_management('Unobtainium');		
		LS_set_guy('scientist');
		LS_set_factory_phase3();
		if(research_given_techs(LS_researches_3a)) return;
//		return build_crates();
		return;
	}
	// TODO guide says the following part is done with avian. my custom is
	// currently not set up for the heat->avian->heat change
	// change the following code after i've changed my custom
	// 17 casino, 3 emissary, 4 repository, clay monuments
	// 3 orbital platforms to support emissaries
	if(!has_tech('tau_red',5) || LS_num('tauceti_casino')<17 || LS_num('overseer')<3 || LS_num('repository')<4 || LS_num('orbital_platform')<3) {
		// my last run had a 3 hour wait for furs that previous runs didn't have
		// reduced to 2 hr 20 min with corpocracy
		if(get_trait_level('lawless')>=1 && !has_trait('unorganized') && MAD_change_government('technocracy','corpocracy')) return;
		if(get_resource('Oil').amount<300000) matter_replicator_management('Oil');
		if(get_resource('Helium_3').amount<100000) matter_replicator_management('Helium_3');
		else matter_replicator_management('Unobtainium');
		// emergency production of cement
		// also emergency production of knowledge if we have ravenous and can't contact
		if(resource_exists('Cement') && get_resource('Cement').amount<5000000) LS_set_guy('cement_worker');
		else if(has_trait('ravenous') && !has_tech('tau_red',5)) LS_set_guy('scientist');
		else LS_set_guy('pit_miner');
		LS_set_factory_phase3();
		// using up clay was a bad idea in my tests
//		if(LS_clay_monuments()) return;		
		if(LS_num('tauceti_casino')<17 && build_structure(['tauceti-tauceti_casino'])) return;
		if(LS_num('repository')<4 && build_structure(['tauceti-repository'])) return;
		// not advisable to do other than contact
		// subjugate: costs 560M money which takes too long
		// introduce: change to scientist temporarily, it isn't too bad.
		//            loyalty buildings cost titanium which is slightly bad
		if(!has_tech('tau_red',5)) {
			// non-synthetic and not ravenous: force contact
			if(!has_trait('artifical') && !has_trait('ravenous')) {
				if(!can_afford_at_max('tauceti','contact','tau_red')) return build_crates();
				return build_structure(['tauceti-contact']);
			} else return build_structure(['tauceti-contact','tauceti-introduce','tauceti-subjugate']);
		}
		// if contact:   evolve.global.race.womling_friend=1
		// if introduce: evolve.global.race.womling_god=1
		// if subjugate: evolve.global.race.womling_lord=1
		if(LS_num('orbital_platform')<3 && build_structure(['tauceti-orbital_platform'])) return;
		// TODO different number of overseers for non-contact
		if(LS_num('overseer')<3 && build_structure(['tauceti-overseer'])) return;
//		return build_crates();
		return;
	}
	// avian supposed done now
	// 3 platform 1 mine 1 farm 4 village
	if(LS_num('orbital_platform')<3 || LS_num('womling_mine')<1 || LS_num('womling_farm')<1 || LS_num('womling_village')<4) {
		if(MAD_change_government('technocracy','corpocracy')) return;
		if(get_resource('Oil').amount<300000) matter_replicator_management('Oil');
		else matter_replicator_management('Helium_3');
		if(resource_exists('Cement') && get_resource('Cement').amount<5000000) LS_set_guy('cement_worker');
		else LS_set_guy('pit_miner');
		LS_set_factory_phase3();
		if(LS_num('orbital_platform')<3 && build_structure(['tauceti-orbital_platform'])) return;
		if(LS_num('womling_mine')<1 && build_structure(['tauceti-womling_mine'])) return;
		if(LS_num('womling_farm')<1 && build_structure(['tauceti-womling_farm'])) return;
		if(LS_num('womling_village')<4 && build_structure(['tauceti-womling_village'])) return;
		if(evolve.global.race.womling_friend==1 && LS_num('overseer')<4 && build_structure(['tauceti-overseer'])) return;
//		return build_crates();
		return;
	}
	// need womling tech level 1 for tau survey
	// research womling lab
	if(!has_tech('tau_red',7)) {
		matter_replicator_management('Oil');
		LS_set_factory_phase4();
		if(get_resource('Knowledge').amount<get_resource('Knowledge').max) {
			LS_set_guy('scientist');
			if(get_trait_level('lawless')>=1 && !has_trait('unorganized') && MAD_change_government('corpocracy','technocracy')) return;
		} else {
			LS_set_guy('pit_miner');
			if(get_trait_level('lawless')>=1 && !has_trait('unorganized') && MAD_change_government('technocracy','corpocracy')) return;
		}
		if(research_given_techs(LS_researches_4)) return;
		if(evolve.global.race.womling_friend==1 && LS_num('overseer')<4 && build_structure(['tauceti-overseer'])) return;
		if(has_tech('tau_red',6) && evolve.global.race.womling_friend==1 && LS_num('womling_fun')<1 && build_structure(['tauceti-womling_fun'])) return;
//		return build_crates();
		return;
	}
	// build womling lab and tavern
	// synthetic needs super duper high storage to afford taverns
	if(LS_num('womling_lab')<1 || (!has_trait('powered') && LS_num('womling_fun')<1)) {
		if(MAD_change_government('technocracy','corpocracy')) return;
		// if caps are too low for taverns, build farms (happens with synthetic)
		// TODO or do i need the steel elsewhere?
//		if(!can_afford_at_max('tauceti','womling_fun','tau_red') && build_structure(['tauceti-tau_farm'])) return true;
		if(get_resource('Oil').amount<300000) matter_replicator_management('Oil');
		else if(get_resource('Elerium').amount<310 && LS_num('womling_lab')<1) matter_replicator_management('Elerium');
		else if(get_resource('Helium_3').max*0.99>get_resource('Oil').amount) matter_replicator_management('Oil');
		else matter_replicator_management('Helium_3');
		LS_set_factory_phase4();
		if(resource_exists('Cement') && get_resource('Cement').amount<5000000) LS_set_guy('cement_worker');
		else LS_set_guy('pit_miner');
		if(LS_num('womling_lab')<1 && build_structure(['tauceti-womling_lab'])) return;
		if(LS_num('womling_fun')<1 && build_structure(['tauceti-womling_fun'])) return;
		if(evolve.global.race.womling_friend==1 && LS_num('overseer')<4 && build_structure(['tauceti-overseer'])) return;
//		return build_crates();
		return;
	}
	// research tau survey, shark rep, belt mining+adv, survey outer
	// patrol ship needed or production becomes 0
	// we're on our scientist, but start building refineries and stuff. stay on
	// corpocracy because we build more than we research
	// build 5 ore ref, 5 extractors, set to neutronium and orichalcum
	// TODO the number of ore refs and extractors might need adjustment
	if(!has_tech('tau_roid',5) || !has_tech('tau_gas2',1) || LS_num('patrol_ship')<5) {
		if(MAD_change_government('technocracy','corpocracy')) return;
		if(LS_num('patrol_ship')<5 && get_resource('Elerium').amount<333) matter_replicator_management('Elerium');
		else if(get_resource('Oil').max*0.99>get_resource('Oil').amount) matter_replicator_management('Oil');
		else matter_replicator_management('Helium_3');
		if(get_resource('Alloy').amount<1500000 && LS_num('mining_ship')<5) LS_set_factory_res('Alloy');
		else LS_set_factory_phase4();
		if(get_resource('Knowledge').amount<get_resource('Knowledge').max) LS_set_guy('scientist');
		else LS_set_guy('pit_miner');
		if(research_given_techs(LS_researches_5)) return;
		// do the naming contest
		if(build_structure(['tauceti-gas_contest','tauceti-roid_mission','tauceti-gas_contest-a8'])) return;
		if(LS_num('refueling_station')<1 && build_structure(['tauceti-refueling_station'])) return;
		if(LS_num('patrol_ship')<5 && build_structure(['tauceti-patrol_ship'])) return;
		if(LS_num('ore_refinery')<2 && build_structure(['tauceti-ore_refinery'])) return;
		if(LS_num('mining_ship')<5 && build_structure(['tauceti-mining_ship'])) return;
		if(LS_num('fusion_generator')<3 && build_structure(['tauceti-fusion_generator'])) return;
		// set sliders on extractor ship
		if(LS_num('mining_ship')>=1) {
			let goal_uncommon=100,uncommon=evolve.global.tauceti.mining_ship.uncommon;
			let q=document.getElementById('iMiningShip');
			if(q==null) console.error('error, no asteroid belt mining ship thingy');
			if(uncommon!=goal_uncommon) {
				while(uncommon<goal_uncommon) uncommon++,q.childNodes[4].childNodes[2].click();
				while(uncommon>goal_uncommon) uncommon--,q.childNodes[4].childNodes[0].click();
			}
			// elerium=0, orichalcum=100
			// we can replicate the tiny bit of elerium we need for upkeep, and for
			// building the 2 buildings that cost elerium
			let goal_rare=0,rare=evolve.global.tauceti.mining_ship.rare;
			if(rare!=goal_rare && q.childNodes[6]!=null) {
				while(rare<goal_rare) rare++,q.childNodes[6].childNodes[2].click();
				while(rare>goal_rare) rare--,q.childNodes[6].childNodes[0].click();
			}
		}
		if(evolve.global.race.womling_friend==1 && LS_num('overseer')<4 && build_structure(['tauceti-overseer'])) return;
//		return build_crates();
		return;
	}
	// build refuel, ore stuff, womling stuff
	// the only reason we want more than 2 ore refineries is for smelters (steel)
	// i should stop having each condition in like 3 places
	// TODO the number of womling loyalty and morale buildings are hardcoded for contact
	// if introduce we will suffer while waiting for titanium
	// if subjugate we already suffered while waiting for money
	if(LS_num('refueling_station')<1 || LS_num('ore_refinery')<4 || LS_num('mining_ship')<5 || LS_num('fusion_generator')<3 || LS_num('tau_farm')<3
	   || LS_num('orbital_platform')<8 || LS_num('womling_farm')<5 || LS_num('womling_mine')<6 || LS_num('womling_village')<10
	   || LS_womling_loyalty_morale()) {
		// have enough oil, coal, elerium to not die, otherwise helium-3
		// don't replicate steel for womling mines, it's very inefficient
		if(MAD_change_government('technocracy','corpocracy')) return;
		if(get_resource('Oil').amount<300000) matter_replicator_management('Oil');
		else if(get_resource('Coal').amount<1000) matter_replicator_management('Coal');
		else if(get_resource('Elerium').amount<100) matter_replicator_management('Elerium');
		else if(get_resource('Helium_3').amount<get_resource('Helium_3').max*0.99) matter_replicator_management('Helium_3');
		else if(LS_num('ore_refinery')<4) matter_replicator_management('Iridium');
		else matter_replicator_management('Titanium');
		// make nanotubes now. not sure if i should start earlier
		if(get_resource('Alloy').amount<1500000 && LS_num('mining_ship')<5) LS_set_factory_res('Alloy');
		else LS_set_factory_phase4();
		LS_set_guy('pit_miner');
		if(build_structure(['tauceti-gas_contest2','tauceti-gas_contest-b8'])) return;
		if(LS_num('refueling_station')<1 && build_structure(['tauceti-refueling_station'])) return;
		if(LS_num('ore_refinery')<5 && build_structure(['tauceti-ore_refinery'])) return;
		// TODO last try spent ages on the 5th extractor ship, low on titanium.
		// worth it i guess since orichalcum is a big bottleneck before reset
		if(LS_num('mining_ship')<5 && build_structure(['tauceti-mining_ship'])) return;
		if(LS_num('fusion_generator')<3 && build_structure(['tauceti-fusion_generator'])) return;
		if(LS_num('tau_farm')<3 && build_structure(['tauceti-tau_farm'])) return;
		if(LS_womling_phase1()) return;
		// start on alien station now i guess
		if(build_structure(['tauceti-alien_station_survey'])) return true;
		if(build_big_structure('tauceti-alien_station',100)) return true;
		// also turn it on
		if(LS_num('alien_space_station')==1) {
			let onoff=get_enabled_disabled('tauceti-alien_space_station');
			if(onoff[0]==0) enable_building('tauceti-alien_space_station');
		}
//		return build_crates();
		return;
	}
	// build and repair alien space station
	if(evolve.global.tauceti.alien_station?.count!=100) {
		if(MAD_change_government('technocracy','corpocracy')) return;
		// chrysotile is the bottleneck
		// or maybe my custom was bad at mining
		if(get_resource('Oil').amount<1000) matter_replicator_management('Oil');
		else if(get_resource('Coal').amount<1000) matter_replicator_management('Coal');
		else if(get_resource('Elerium').amount<100) matter_replicator_management('Elerium');
		else if(resource_exists('Chrysotile')) matter_replicator_management('Chrysotile');
		else matter_replicator_management('Helium_3');
		LS_set_factory_phase5();
		LS_set_guy('pit_miner');
		if(build_structure(['tauceti-alien_station_survey','tauceti-alien_station'])) return true;
//		return build_crates();
		if(LS_late_monuments()) return true;
		return;
	}
	// decrypt alien space station, research all new techs
	// build ringworld as we research techs
	// probably good to build fusion generators to fuel matter replicator,
	// no overlapping resources with ringworld except a bit of money
	if(evolve.global.tauceti.ringworld?.count!=1000) {
		// build the 5th ore refinery late if we didn't finish it earlier
		// i don't think it delays the ending (iridium is the bottleneck, and
		// ringworld doesn't cost iridium)
		// TODO only build more ore refineries if we don't need more fusion generators
		// which can be an issue outside of antimatter
		if(LS_num('ore_refinery')<5 && build_structure(['tauceti-ore_refinery'])) return;
		// don't run out of upkeep resources + replicate bottleneck
		// have a bank of 5100 elerium for garden of eden
		if(get_resource('Oil').amount<1000) matter_replicator_management('Oil');
		else if(get_resource('Coal').amount<1000) matter_replicator_management('Coal');
		else if(get_resource('Elerium').amount<6000) matter_replicator_management('Elerium');
		else if(get_resource('Helium_3').amount<6000) matter_replicator_management('Helium_3');
		else if(get_resource('Neutronium').amount<7000) matter_replicator_management('Neutronium');
		else if(get_resource('Chrysotile').amount<100000) matter_replicator_management('Chrysotile');
		else if(get_resource('Adamantite').amount<110000) matter_replicator_management('Adamantite');
		else if(get_resource('Bolognium').amount<6000) matter_replicator_management('Bolognium');
		else matter_replicator_management('Orichalcum');
		// produce some stanene
		LS_set_factory_phase6();
		// change back to pit miner after we have researched the useful techs
		// and maybe some stored-up knowledge?
		if(has_tech('tau_ore_mining',2) && get_resource('Knowledge').amount>=get_resource('Knowledge').max*0.01) LS_set_guy('pit_miner');
		else LS_set_guy('scientist');
		// change back to technocracy
		if(MAD_change_government('corpocracy','technocracy')) return;
		// turn on alien space station
		let onoff=get_enabled_disabled('tauceti-alien_space_station');
		if(onoff[0]==0) enable_building('tauceti-alien_space_station');
		// alien research
		if(research_given_techs(LS_researches_6)) return;
		// if bottleneck is neutronium and we can afford another patrol+extractor
		// ship, build them
		if(get_resource('Neutronium').amount<7000) {
			if(LS_num('patrol_ship')==LS_num('mining_ship') && can_afford_thing('tauceti','mining_ship','tau_roid') && build_structure(['tauceti-patrol_ship'])) return true;
			if(LS_num('patrol_ship')>LS_num('mining_ship') && build_structure(['tauceti-mining_ship'])) return true;
		}
		// bottleneck: probably orichalcum
		if(build_big_structure('tauceti-ringworld',1000)) return;
		if(build_structure(['tauceti-fusion_generator'])) return;
		if(LS_late_monuments()) return true;
//		return build_crates();
		return;
	}
	// last stretch
	// we NEED technocracy or we'll have hard time raising the knowledge cap
	// otherwise we need like 2 womling labs, 3 science labs and a bunch of
	// supercolliders
	if(MAD_change_government('corpocracy','technocracy')) return;
	if(!has_tech('eden',2)) LS_set_guy('scientist');
	else LS_set_guy('pit_miner');
	if(research_given_techs(LS_researches_7)) return;
	// we'll need 2.54 mill graphene, which should be reasonably fast with
	// replicator. also keep upkeep resources in check
	if(get_resource('Oil').amount<1000) matter_replicator_management('Oil');
	else if(get_resource('Coal').amount<1000) matter_replicator_management('Coal');
	else if(get_resource('Elerium').amount<5100) matter_replicator_management('Elerium');
	else if(get_resource('Helium_3').amount<6000) matter_replicator_management('Helium_3');
	else matter_replicator_management('Graphene');
	if(LS_late_monuments()) return true;
	LS_set_factory_phase6();
	if(!can_afford_at_max('tauceti','goe_facility','tau_star')) {
		return build_crates();
	}
	// don't pull the trigger. not much of a reason to wait though
//		return build_crates();
		return;
}

//---------------------------------------------------------------------
// code for warlord - farm bloodstones, artifacts, supercoiled plasmids
//---------------------------------------------------------------------

// made because it's less programming work than implementing demonic
// infusion and apotheosis and gives 3 different t5+ prestige resources
// it's also repeatable back-to-back unlike apotheosis
// on the flipside i need to care (slightly) about authority

// test run (as i was writing the script) took 97k days, spire @ level 96
// (from a savegame that hadn't done warlord)
// lap times:
// 4900 days: create codex
// 9225 days: first harbor
// 11200 days: first mech bay (demon artificer)
// 20745 days: spire level 20 reached
// 38800 days: spire level 47 reached
// 42000 days: entered edenic realm
// 59880 days: elerium cannon built
// 62500 days: first spirit vacuum built (several spirit batteries build before that)

// i wonder if wendigo, inherit wendigo, deify wendigo is good because ghostly
// trait is fantastic. or maybe replace one of the wendigos with djinn because
// wish is also a great trait
// eden is a good planet with elemental (for more power)

function warlord_attack_fortress() {
	if(!evolve.global.portal.throne.hasOwnProperty('enemy')) return;
	if(evolve.global.portal.throne.enemy.length>0) {
		// there's at least one enemy, attack
		// no vue action it seems
		let q=document.getElementById('fort'); 
		q.firstChild.childNodes[2].childNodes[1].click();
	}
}

function warlord_assign_points() {
	// evolve.global.portal.throne.points: number of points to assign
	// assign to least points first i guess
	let prt=evolve.global.portal;
	if(prt.throne.hearts?.length>0) {
		// if we have hearts, consume them
		let q=document.getElementById('portal-throne');
		if(q==null) console.log('warlord no throne sanity error');
		q.__vue__.action();
		return true;
	}
	if(prt.throne.points>0) {
		// find building with fewest points
		let low=99;
		let lowb='';
		for(let b in prt) if(prt[b].hasOwnProperty('rank')) if(low>prt[b].rank) low=prt[b].rank,lowb=b;
		let q=document.getElementById('portal-throne');
		if(q==null) console.log('warlord no throne sanity error');
		let r=document.getElementById('portal-'+lowb);
		if(r==null) { console.log('tried to assign points to nonexisting building',lowb); return false; }
		// enter assign points mode, assign, leave assign points mode
		if(low==5) return false; // done
		q.__vue__.action();
		r.__vue__.action();
		q.__vue__.action();
		return true;
	}
	return false;
}

function warlord_build_buildings_we_want() {
	if(build_structure(['portal-hovel','portal-dig_demon','portal-brute','portal-tunneler','portal-incinerator'])) return true;
	// build the following only if surplus power
	if(get_power_minus_replicator()>5) {
		if(hell_num('mortuary')<14 && build_structure(['portal-mortuary'])) return true;
		// don't buy twisted labs during spirit vacuum phase (save up graphene)
		if(!has_tech('isle',1) && build_structure(['portal-twisted_lab'])) return true;
		if(build_structure(['portal-hell_casino','portal-demon_forge','portal-hell_factory','portal-shadow_mine'])) return true;
		// stop building soul attractors when we're in spirit vacuum phase in eden
		if(!has_tech('isle',5) && hell_num('soul_forge')==1 && build_structure(['portal-soul_attractor'])) return true;
	}
	return false;
}

function warlord_buy_minor_traits() {
	// can't do this until i've unlocked genetic sequencing
	let list=[];
	// priorities in warlord
	// more or less determined on a whim
	list.push('mastery'); list.push(5);
	// ignore hardy if cement doesn't exist
	if(resource_exists('Cement')) list.push('hardy'),list.push(5);
	list.push('analytical'); list.push(2);
	list.push('tactical'); list.push(6);
	list.push('fibroblast'); list.push(3);
	list.push('content'); list.push(2);
	list.push('ambidextrous'); list.push(4);
	list.push('metallurgist'); list.push(4);
	list.push('cunning'); list.push(3);
	list.push('promiscuous'); list.push(6);
	list.push('gambler'); list.push(2);
	arpa_genetics_buy_genes(list);
}

function hell_build_transports() {
	let max=evolve.global.portal.harbor.s_max;
	let cur=evolve.global.portal.harbor.support;
	if(cur<max) {
		// when we have i biremes, build up to table[i] transports
		let table=[0,2,3,5,8,11,15,19,25,33,42,54,68,86,109,138];
		let bi=hell_num('bireme');
		let tr=hell_num('transport');
		// build ships
		if(bi>=table.length || tr>=table[bi]) {
			// build bireme
			return build_structure(['portal-bireme']);
		} else {
			// build transport unless capped
			if(can_afford_at_max('portal','transport','prtl_lake')) {
				return build_structure(['portal-transport']);
			} else return build_structure(['portal-bireme']);
		}
	}
	return false;
}

// if i want to use this function for normal spire, i guess i need a
// function pointer to warlord_mech_bay_full
function hell_spire_buildings() {
	if(!building_exists('portal','purifier')) return false;
	let max=evolve.global.portal.purifier.s_max;
	let cur=hell_num('port')+hell_num('base_camp')+hell_num('mechbay');
	// builds a bunch of ports/base camps, builds 3 mech bays, maxes out purifiers
	// then builds the rest of the mech bays
	let onoff_mech=get_enabled_disabled('portal-mechbay');
	let onoff_port=get_enabled_disabled('portal-port');
	let onoff_camp=get_enabled_disabled('portal-base_camp');
	if(cur>max-1 && onoff_mech[1]==0 && onoff_port[1]==0 && onoff_camp[1]==0) {
		if(can_afford_at_max('portal','purifier','prtl_spire')) return build_structure(['portal-purifier']);
		else if(build_structure(['portal-mechbay'])) return true;
	}
	// this if is extremely fishy
	if(cur>max || onoff_mech[1]>0 || evolve.global.portal.purifier.s_max>evolve.global.portal.purifier.support) {
		// we have overbuilt, manage support
		// with all mech bays on, max support ~ mech bays + (port) + (port-3)
		// account for the case where script disabled support for mech buys to buy
		// other stuff
		// don't buy ports and base camps during this phase as a main rule,
		// we should have overbuilt already
		let left=Math.ceil(max)-onoff_mech[0];
		let newstuff=spire_balance(hell_num('port'),hell_num('base_camp'),left);
		let newport=newstuff[0],newcamp=newstuff[1];
		let change=newport!=onoff_port[0] || newcamp!=onoff_camp[0];
		while(newport>onoff_port[0]) enable_building('portal-port'),newport--;
		while(newport<onoff_port[0]) disable_building('portal-port'),newport++;
		while(newcamp>onoff_camp[0]) enable_building('portal-base_camp'),newcamp--;
		while(newcamp<onoff_camp[0]) disable_building('portal-base_camp'),newcamp++;
		if(change) return true; // only return true if we enabled/disabled something
		// the following block only around spire level 25-30 to build more stuff
		if(onoff_mech[1]>0) {
			// if everything is capped, turn off more mech bays
			if(!can_afford_at_max('portal','purifier','prtl_spire') &&
			   !can_afford_at_max('portal','mechbay','prtl_spire') &&
			   !can_afford_at_max('portal','bazaar','prtl_spire')) {
				// we were already at 0 mech bays, turn them on to exit build mode
				if(onoff_mech[0]==0) {
					let num=hell_num('mechbay');
					for(let i=0;i<num;i++) enable_building('portal-mechbay');
					return true;
				}
				disable_building('portal-mechbay');
				return true;
			}
			// there exists an uncapped building, attempt to build any of them
			if(build_structure(['portal-purifier'])) {
				// if we built a purifier, enable a mech bay
				// but don't enable all of because that exits build mode
				if(onoff_mech[1]>1) enable_building('portal-mechbay');
				return true;
			}
			// normally don't build base camps, but we can build if none are disabled,
			// might need more after buying more purifiers
			if(get_enabled_disabled('portal-base_camp')[1]==0 && build_structure(['portal-base_camp'])) return true;
			return build_structure(['portal-mechbay','portal-bazaar']);
		}
	}
 	// first 5 are always ports
	let ports=hell_num('port');
	if(ports<5) return build_structure(['portal-port']);
	let camps=hell_num('base_camp');
	// can build more than 3 mech bays here, try raising to 7 or something
	// we'll climb faster and cost creep will probably let us end in a similar
	// state, but faster
	if(ports>=10 && hell_num('mechbay')<3) return build_structure(['portal-mechbay']);
	// let base camps lag behind by 3-4
	if(ports-camps>3 && can_afford_at_max('portal','base_camp','prtl_spire')) {
		return build_structure(['portal-base_camp']);
	} else if(can_afford_at_max('portal','port','prtl_spire')) {
		if(build_structure(['portal-port'])) return true;
	} else if(can_afford_at_max('portal','base_camp','prtl_spire')) {
		return build_structure(['portal-base_camp']);
	} else return build_structure(['portal-mechbay']);
	return false;
}

function warlord_bazaar() {
	if(building_exists('portal','bazaar')) {
		// build a couple of bazaars immediately i guess
		// more than 3 if we build like 7 mechbays very early
		if(hell_num('bazaar')<3 && build_structure(['portal-bazaar'])) return true;
		// build bazaars when mech bays are maxed out and full
		if(!can_afford_at_max('portal','mechbay','prtl_spire') && warlord_mech_bay_full() && build_structure(['portal-bazaar'])) return true;
	}
	return false;
}

// all in bolognium
function warlord_transport_cargo() {
	let q=document.getElementById('supplyBolognium');
	if(q==null) return false;
	let max=evolve.global.portal.transport.cargo.max;
	let cur=evolve.global.portal.transport.cargo.Bolognium;
	while(cur<max) q.__vue__.supplyMore('Bolognium'),cur++;
}

// determine when mech bays are full:
// governor task builds the following:
//  - minion (1-16), 1 space each for 16 => 16
//  - fiend (17-30), 3 space each for 42 => 58
//  - cyberdemon (31-34), 6 space each for 24 => 82
//  - fiend (35-39), 3 space each for 15 => 97
//  - archfiend (40-44), 15 space each for 75 => 172
//  - cyberdemon (45-46), 6 space each for 12 => 184
//  - minion (47-62), 1 space each for 16 => 200
//  - cyberdemon (63-forever), 6 space each
// exceptions to full being occupied>max-6:
// 25/25, 49/50, 97/100, 112/125, 142/150, 172/175, 200/200
// the numbers are different in normal spire
function warlord_mech_bay_full() {
	let m=evolve.global.portal.mechbay;
	return (m.bay>=25 && m.max==25) || (m.bay>=49 && m.max==50) || (m.bay>=97 && m.max==100) || (m.bay>=112 && m.max==125) || (m.bay>=142 && m.max==150) || (m.bay>=172 && m.max==175) || (m.bay>=200 && m.max==200) || (m.bay>m.max-6);
}

function warlord_mech_management() {
	// if any mech bays are disabled, make sure task is disabled
	// TODO soul gems are easier to get in warlord and infernal mecha are
	// cheaper than normal, maybe just buy them
	let onoff_mech=get_enabled_disabled('portal-mechbay');
	// disable mech constructor when mech bay is full to avoid infernal mechs
	// (save the soul gems for elerium cannon and stuff)
	if(warlord_mech_bay_full() || onoff_mech[1]>0) return remove_governor_task('mech');
	else return set_governor_task('mech');
}

// given number of ports and base camps and max support, return the distribution
// that maximizes max supplies
function spire_balance(numport,numcamp,max) {
	if(numport+numcamp<max) return [numport,numcamp]
	let newport=Math.trunc((max+3)/2.0);
	let newcamp=Math.ceil(max-newport);
	// rebalance if we don't have enough of one type
	if(newport>numport) {
		let diff=newport-numport;
		newport-=diff;
		newcamp+=diff;
	}
	if(newcamp>numcamp) {
		let diff=newcamp-numcamp;
		newcamp-=diff;
		newport+=diff;
	}
	return [newport,newcamp];
}

// determine if it's worth it to disable some mech bays and push buildings that
// cost supplies
// it should be beneficial to do it once, at around spire level 30
function hell_potential() {
	let po=evolve.global.portal;
	let max=po.purifier.s_max;
	let port_camp=spire_balance(hell_num('port'),hell_num('base_camp'),max);
	let port=port_camp[0],camp=port_camp[1];
	if(port+camp>max) camp-=port+camp-max;
	let supply=(10000*(0.4*camp))*port;
	// compare to purifier cost to find potential
	let cost=get_building_cost('portal-purifier');
	let val=get_resource_cost_from_list(cost,'Supply');
	// the actual potential is higher because we should be able to buy more purifiers
	return 1.0*supply/val;
}

// don't build demon (mech) station
function eden_build_asphodel(free,support) {
	let max=evolve.global.eden.encampment.s_max;
	let cur=evolve.global.eden.encampment.support;
	if(build_structure(free)) return true;
	// don't build stabilizers if we are building spirit vacuum stuff,
	// need vitreloy for spirit batteries
	if(!has_tech('isle',5) && building_exists('eden','warehouse') && building_exists('eden','stabilizer')) {
		if(get_building('eden','warehouse').count>get_building('eden','stabilizer').count) {
			if(build_structure(['eden-stabilizer'])) return true;
		}
	}
	if(cur>=max) {
		if(get_power_minus_replicator()>620 && build_structure(['eden-encampment'])) return true;
		return false;
	}
	if(build_structure(support)) return true;
	return false;
}

function eden_fortress_action(id) {
console.log('attack',id);
	let q=document.getElementById(id);
	q.__vue__.action();
	return true;
}

// order:
// patrols to 18 -> celestial tactics
// readiness to 99 -> active camouflage
// patrols to 15, readiness to 80 -> special ops training
// only tested in warlord
// should work in apotheosis if hell fortress is stable with no merc governor,
// but it's going to be very slow unless combat rating is extremely good
// (it might also be beneficial to turn off all attractor beacons during this phase)
function eden_attack_fortress() {
	let fort=evolve.global.eden.fortress;
	let a=fort.armory,d=fort.detector,f=fort.fortress,p=fort.patrols;
	if(f==0) return false;
	if(evolve.global.civic.garrison.max-evolve.global.civic.garrison.workers>3) {
		// buy mercenaries
		if(get_eden_mercenary_cost()<evolve.global.resource.Money.amount) {
			hire_mercenary();
			return true;
		}
		return false;
	}
	if(p>18) return eden_fortress_action('eden-ambush_patrol');
	if(has_tech('celestial_warfare',2)) {
		if(a==100) return eden_fortress_action('eden-raid_supplies');
	}
	if(has_tech('celestial_warfare',3)) {
		if(p>15) return eden_fortress_action('eden-ambush_patrol');
		else if(a>80) return eden_fortress_action('eden-raid_supplies');
	}
	if(has_tech('celestial_warfare',5)) {
		if(p>0) return eden_fortress_action('eden-ambush_patrol');
		else if(a>0) return eden_fortress_action('eden-raid_supplies');
		else if(f>0) return eden_fortress_action('eden-siege_fortress');
	}
	return false;	
}

function eden_build_elysium() {
	if(build_one(['eden-pillbox'])) return true;
	if(eden_num('elysanite_mine')<18 && build_structure(['eden-elysanite_mine'])) return true;
	if(eden_num('sacred_smelter')<12 && build_structure(['eden-sacred_smelter'])) return true;
	return false;
}

function spirit_vacuum_power() {
	let coeff=0.9;
	if(has_tech('asphodel',13)) coeff=1-(1+eden_num('corruptor')*0.03)/10;
	return 18000*Math.pow(coeff,eden_num('spirit_battery'));
}

function warlord_bot() {
	if(evolve.global.race.hasOwnProperty('lone_survivor')) return lone_survivor_bot();
	if(!evolve.global.race.hasOwnProperty('warlord')) {
		console.log('ERROR, attempted to run warlord script outside of scenario');
		return;
	}
	// attack the first fortress all the time
	warlord_attack_fortress();
	if(handle_modals()) return;
	// research techs
	if(research_tech(tech_avoid_safeguard)) return true;
	// assign points
	if(warlord_assign_points()) return true;
	if(set_governor('criminal')) return;
	if(set_governor_task('bal_storage')) return;
	// set crate distribution: graphene 4x for divinity infuser
	// stone 3x for hellspawn hovels, food 4x for tunneler demons,
	// bolognium 2x for inferno reactors, orichalcum 4x for soul engines
	// adamantite 3x for shadow mines
	// cement 4x for tomb of dead god
	if(set_crate_manager(['Graphene',4,'Stone',3,'Food',4,'Bolognium',2,'Orichalcum',4,'Cement',4,'Adamantite',3])) return true;
	// if we somehow have an unfinished arpa project: finish it
	if(finish_unfinished_arpa_project()) true;
	MAD_set_smelter_output();
	sacrificial_altar();
	// wishes
	if(can_minor_wish()) {
		let w=evolve.global.race.wishStats;
		if(!w.strong) make_minor_wish('strength'); // strong r0.25
		else if(!w.tax) make_minor_wish('money'); // 55% tax limit
		// alternatively, wish for strengh (soldiers) which is good for authority
		else make_minor_wish('res');
	}
	if(can_major_wish()) {
		let w=evolve.global.race.wishStats;
		if(!w.casino) make_major_wish('money'); // casino profits
		else if(!w.gov) make_major_wish('power'); // dictator
		// we might be capped on every resource at some points during the spire
		// level 50 grind. wishing for resources has a good chance of giving soul
		// gems (or something useless like chrysotile)
		else make_major_wish('res');
	}
	warlord_buy_minor_traits();
	warlord_transport_cargo();
	// phase 1: fix bottlenecks:
	//          money (for now, set factories to luxury goods)
	//          knowledge (twisted labs, more power to build more twisted labs)
	// we need more population, more soldiers
	// research demon tunnelers for infernite so we can build incinerators for power
	let desired1=['portal','twisted_lab',2];
	if(!we_have_buildings(desired1)) {
		set_factory_production_percent(['Lux',100]);
		// highest tax such that morale >= 100%
		tax_morale_balance(0,55,100);
		// ocular: telekinesis, then whatever
		set_ocular_power(['t','d','p']);
		// want infernite to build incinerators
		matter_replicator_management('Infernite');
		// need wrought iron for miners
		assign_population('Wrought_Iron',true,true);
		// TODO lesser wish for money (i think) because it's a big bottleneck
		// TODO greater wish for money for casino income i guess
		if(build_desired_buildings(desired1)) return true;
		if(build_structure(['portal-hovel','portal-dig_demon','portal-brute','portal-pumpjack'])) return true;
		// TODO shrines should be all in metal production, knowledge is bad here
		if(build_shrine()) return true;
		if(has_trait('calm') && build_structure(['city-meditation'])) return true;
		return build_crates();
	}
	// build more twisted labs, build demon tunnelers, incinerators, dens of sin
	let desired2=['portal','twisted_lab',3,'incinerator',2];
	if(!we_have_buildings(desired2)) {
		set_factory_production_percent(['Lux',100]);
		tax_morale_balance(0,55,100);
		set_ocular_power(['t','d','p']);
		matter_replicator_management('Infernite');
		assign_population('Wrought_Iron',true,true);
		if(build_desired_buildings(desired2)) return true;
		if(build_structure(['portal-hovel','portal-dig_demon','portal-brute','portal-pumpjack','portal-tunneler'])) return true;
		if(build_shrine()) return true;
		if(has_trait('calm') && build_structure(['city-meditation'])) return true;
		return build_crates();
	}
	// build up more until we have researched minions
	if(!has_tech('hellspawn',3)) {
		set_factory_production_percent(['Lux',100]);
		tax_morale_balance(0,55,100);
		set_ocular_power(['t','d','p']);
		matter_replicator_management('Infernite');
		assign_population('Wrought_Iron',true,true);
		if(warlord_build_buildings_we_want()) return;
		if(build_shrine()) return true;
		if(has_trait('calm') && build_structure(['city-meditation'])) return true;
		return build_crates();
	}
	// we have minions, fortresses appear now i guess
	// more general buildup, focus solely on create codex when it's affordable
	// we need A LOT of power to start boiling lake, at least 2 harbors needed
	// (1000 MW) to begin with transports, and putrifiers draw 100 MW each
	if(hell_num('codex')<1) {
		// we need a lot of flesh (furs)
		set_factory_production_percent_check_cap(['Lux',40,'Nano',20,'Furs',40]);
		tax_morale_balance(0,55,100);
		set_ocular_power(['d','t','p']);
		// set crafters to mythril after like 10 dig demons
		assign_population(hell_num('dig_demon')<10?'Wrought_Iron':'Mythril',true,true);
		// if we don't have nanoweave containers, replicate nanoweave
		// also avoid running out of polymer
		if(get_resource('Polymer').amount<20000) matter_replicator_management('Polymer');
		else if(get_resource('Alloy').amount<20000) matter_replicator_management('Alloy');
		else if(!has_tech('steel_container',8)) matter_replicator_management('Nanoweave');
		else matter_replicator_management('Infernite');
		// at some point we stop making anything and wait for codex
		// it doesn't want to happen on its own
		// also, avoid the potential softlock when 3 fortresses suddenly arrive and
		// we'll never be able to have 3000 minions
		if(hell_num('soul_forge')==1 && hell_num('soul_attractor')>=5 && can_afford_at_max('portal','codex','prtl_badlands')) {
			return build_structure(['portal-codex']);
		}
		// soul reapers cost soul gems, but they are extremely good
		if(build_structure(['portal-minions','portal-reaper','portal-codex'])) return true;
		if(warlord_build_buildings_we_want()) return true;
		if(hell_num('soul_forge')<1 && get_power_minus_replicator()>30 && build_structure(['portal-soul_forge'])) return true;
		if(build_storage_if_capped(['portal-incinerator'])) return true;
		if(build_shrine()) return true;
		if(has_trait('calm') && build_structure(['city-meditation'])) return true;
		// buy supercolliders when we can afford fully i guess
		// this spends our stock of polymer, so no more twisted labs for a while
		if(can_afford_arpa('lhc')==100) return build_arpa_project('lhc');
		return build_crates();
	}
	// we have codex now
	// stall until 10 corpse piles, cybernetics, vault, 15 demon forges
	if(hell_num('corpse_pile')<10 || !has_tech('high_tech',8) || hell_num('war_vault')<1 || hell_num('demon_forge')<15) {
		set_factory_production_percent_check_cap(['Alloy',8,'Stanene',8,'Nano',8,'Polymer',8,'Lux',50,'Furs',18]);
		tax_morale_balance(0,55,100);
		set_ocular_power(['d','t','p']);
		// set crafters to sheet metal for more demon forges and more crafters
		assign_population('Sheet_Metal',true,true);
		// if we don't have nanoweave containers, replicate nanoweave
		// also avoid running out of polymer
		if(get_resource('Polymer').amount<20000) matter_replicator_management('Polymer');
		else if(get_resource('Alloy').amount<20000) matter_replicator_management('Alloy');
		else if(!has_tech('steel_container',8)) matter_replicator_management('Nanoweave');
		else if(!has_tech('high_tech',18) && get_resource('Vitreloy').amount<10500000) matter_replicator_management('Vitreloy');
		else if(get_resource('Infernite').amount<get_resource('Infernite').max*0.999) matter_replicator_management('Infernite');
		else matter_replicator_management('Sheet_Metal');
		if(hell_num('war_vault')<1 && build_structure(['portal-war_vault'])) return true;
		// soul reapers cost soul gems, but they are extremely good
		if(build_structure(['portal-minions','portal-reaper','portal-corpse_pile'])) return true;
		if(build_structure(['portal-hell_forge','portal-inferno_power'])) return true;
		if(warlord_build_buildings_we_want()) return true;
		if(build_storage_if_capped(['portal-incinerator','portal-tunneler'])) return true;
		if(build_shrine()) return true;
		if(has_trait('calm') && build_structure(['city-meditation'])) return true;
		if(!can_afford_at_max('portal','harbor','prtl_lake') && build_structure(['portal-warehouse'])) return true;
		if(evolve.global.arpa.lhc.rank<55 && can_afford_arpa('lhc')==100) return build_arpa_project('lhc');
		return build_crates();
	}
	// build harbors, transports, biremes
	// build spire buildings
	// so much for dividing the run into small and nice chunks
	// this phase ends when entering edenic realm
	if(!has_tech('edenic',2)) {
		set_factory_production_percent_check_cap(['Alloy',10,'Stanene',10,'Nano',10,'Polymer',20,'Lux',30,'Furs',20]);
		tax_morale_balance(0,55,100);
		set_ocular_power(['d','t','p']);
		// build one of these in case it unlocks something
		if(build_one(['portal-tavern'])) return true;
		// assign crafters to bricks for cooling towers up to a fixed stockpile
		// then craft mythril for brute huts until max authority
		// then craft wrought iron for dig demons
		// craft sheet metal when demon forges are lagging behind
		let onoff_mech=get_enabled_disabled('portal-mechbay');
		if(hell_num('harbor')>0 && can_afford_at_max('portal','cooling_tower','prtl_lake') && get_resource('Brick').amount<0.9999*get_resource_cost_from_list(get_building_cost('portal-cooling_tower'),'Brick')) assign_population('Brick',true,true);
		else if(evolve.global.resource.Authority.amount<evolve.global.resource.Authority.max && can_afford_at_max('portal','brute','prtl_wasteland')) assign_population('Mythril',true,true);
		else if(onoff_mech[1]>0 && get_resource('Brick').amount<get_resource('Wrought_Iron').amount*2) assign_population('Brick',true,true);
		else if(onoff_mech[1]>0) assign_population('Wrought_Iron',true,true);
		else if(hell_num('dig_demon')-hell_num('demon_forge')>6 && can_afford_at_max('portal','demon_forge','prtl_wasteland')) assign_population('Sheet_Metal',true,true);
		else if(can_afford_at_max('portal','dig_demon','prtl_wasteland')) assign_population('Wrought_Iron',true,true);
		else assign_population('Mythril',true,true);
		// replicate aerogel for soul attractors when they aren't maxed
		if(get_resource('Oil').amount<10000) matter_replicator_management('Oil');
		if(get_resource('Polymer').amount<20000) matter_replicator_management('Polymer');
		else if(get_resource('Alloy').amount<20000) matter_replicator_management('Alloy');
		else if(can_afford_at_max('portal','soul_attractor','prtl_pit')) matter_replicator_management('Aerogel');
		else if(get_resource('Infernite').amount<get_resource('Infernite').max*0.999) matter_replicator_management('Infernite');
		else matter_replicator_management('Sheet_Metal');
		// soul reapers cost soul gems, but they are extremely good
		if(build_structure(['portal-minions','portal-reaper','portal-corpse_pile'])) return true;
		if(build_structure(['portal-hell_forge','portal-inferno_power'])) return true;
		if(get_power_minus_replicator()>500 && build_structure(['portal-harbor'])) return true;
		if(hell_num('harbor')>0 && build_structure(['portal-cooling_tower'])) return true;
		if(hell_num('harbor')>0 && hell_build_transports()) return true;
		if(build_structure(['portal-harbor','portal-inferno_power'])) return true;
		if(warlord_build_buildings_we_want()) return true;
		if(build_storage_if_capped(['portal-incinerator','portal-tunneler','portal-shadow_mine'])) return true;
		if(build_shrine()) return true;
		if(has_trait('calm') && build_structure(['city-meditation'])) return true;
		if(!can_afford_at_max('portal','harbor','prtl_lake') && build_structure(['portal-warehouse'])) return true;
		if(can_afford_arpa('lhc')==100) return build_arpa_project('lhc');
		if(get_production('Oil')<0 && build_structure(['portal-pumpjack'])) return true;
		if(hell_spire_buildings()) return true;
		if(hell_num('mechbay')>0 && warlord_mech_management()) return true;
		// by the time we have 20 ports we're just waiting with lots of full caps
		// so build some supercolliders
		if(hell_num('port')>20) {
			let low=can_afford_arpa('lhc','Knowledge');
			let low2=can_afford_arpa('lhc');
			if(low==100 && low2>0 && build_arpa_project('lhc')) return true;
			// build a few railways as well, they're great when we enter eden
			if(evolve.global.arpa.railway.rank<50 && can_afford_arpa('railway')==100 && build_arpa_project('railway')) return true;
		}
		if(warlord_bazaar()) return true;
		// build waygate whenever supplies are max'd, population is close to max,
		// bazaars are max'd
		// if it isn't done by level 50, make it a priority
		// only build 9 segments now so i don't have to write code to turn it off
		// because we don't want to fight demon lord until level 50
		if(has_tech('waygate',1) && !has_tech('waygate',2)) {
			let pop=evolve.global.resource[evolve.global.race.species];
			if(!can_afford_at_max('portal','purifier','prtl_spire') &&
			   !can_afford_at_max('portal','port','prtl_spire') &&
			   !can_afford_at_max('portal','base_camp','prtl_spire') &&
			   !can_afford_at_max('portal','mechbay','prtl_spire') &&
			   !can_afford_at_max('portal','bazaar','prtl_spire') &&
			   warlord_mech_bay_full() && hell_num('waygate')<9 &&
			   pop.amount>pop.max-10) {
				if(build_structure(['portal-waygate'])) return true;
			}
		}
		// we shouldn't be in build more before spire level 25, turn off by force
		if(onoff_mech[1]>0 && hell_num('spire')<25) return fully_enable_building('portal-mechbay');
		// activate "spire buildup mode" after spire level 25 when we encounter a
		// tough enemy, or after spire level 30, as long as there's potential to
		// build more stuff.
		// when there's a disabled mech bay, the script is in spire buildup mode
		// at high progression where every boss is beaten quicky (at least compared
		// to the gratingly slow supplies) we might want to skip this building phase
		// don't enter build mode after level 42 (arbitratily chosen), we can build
		// as much as we want at level 51 when we enter eden anyway
		// worry about this later if we ever encounter a 15-hour boss or something
		if(hell_num('spire')<42 && onoff_mech[1]==0 && ((hell_num('spire')>=25 && convert_to_seconds(evolve.global.portal.spire.time)>5400 && hell_potential()>1.4)
		   || (hell_num('spire')>=30 && hell_potential()>1.45))) {
			disable_building('portal-mechbay');
			return true;
		}
		// after the spire building phase start spamming railways for coming transport boost
		// level 35 is just a guesstimate because i don't want to build too early
		// reserve level 49 for finishing the last railway we started as i expect
		// them to be extremely expensive at this point
		// or just stop at 150 which should be enough
		if(hell_num('spire')>=35 && onoff_mech[1]==0 && hell_num('spire')<49) {
			if(evolve.global.arpa.railway.rank<150 && can_afford_arpa('railway')>0 && build_arpa_project('railway')) return true;
		}
		// fight demon lord at spire level 50
		if(hell_num('spire')>=50 && !has_tech('waygate',2)) {
			// if we reached level 50 while still in build mode, abort it by force
			// we'll soon be able to uncap support in spire with asphodel harvesters
			// TODO force-end building more earlier than that? like level 40
			if(onoff_mech[1]>0) return fully_enable_building('portal-mechbay');
			// finish waygate now
			if(hell_num('waygate')<10) {
				let pop=evolve.global.resource[evolve.global.race.species];
				if(pop.amount>pop.max-10 && build_structure(['portal-waygate'])) return true;
				// this should auto-enable demon lord so we don't have to do it
			}
		}
		// while in spire buildup mode, build stock exchanges to afford more
		// ports/base camps since they are typically capped by money
		// and also incidently afford other money-capped buildings
		if(onoff_mech[1]>0) {
			if(can_afford_arpa('stock_exchange')==100 && build_arpa_project('stock_exchange')) return true;
		}
		// whenever authority is max'd, build a monument
		// number of brutes capped on number of demon forges to avoid "stunlocking"
		// other crafting resources
		if(hell_num('brute')<hell_num('demon_forge') && evolve.global.resource.Authority.max==evolve.global.resource.Authority.amount) {
			if(can_afford_arpa('monument')==100 && build_arpa_project('monument')) return true;
		}
		// research purify essence
		if(research_given_techs(new Set(['purify_essence']))) return true;
		return build_crates();
	}
	// eden unlocked: survey meadows
	if(!has_tech('edenic',4)) {
		set_factory_production_percent_check_cap(['Alloy',10,'Stanene',10,'Nano',10,'Polymer',20,'Lux',30,'Furs',20]);
		tax_morale_balance(0,55,100);
		set_ocular_power(['d','t','p']);
		assign_population('Mythril',true,true);
		matter_replicator_management('Sheet_Metal');
		if(hell_spire_buildings()) return true;
		if(hell_num('mechbay')>0 && warlord_mech_management()) return true;
		if(!has_tech('edenic',3)) return build_structure(['portal-edenic_gate']);
		if(!has_tech('edenic',4)) return build_structure(['eden-survery_meadows']);
		return build_crates();
	}
	// build stuff on asphodel meadows
	if(!has_tech('elysium',2)) {
		set_factory_production_percent_check_cap(['Alloy',40,'Stanene',10,'Nano',20,'Polymer',10,'Lux',10,'Furs',10]);
		tax_morale_balance(0,55,100);
		set_ocular_power(['d','t','p']);
		assign_population('Mythril',true,true);
		// we need a ton of vitreloy now, need to replicate occasionally
		if(can_afford_at_max('portal','soul_attractor','prtl_pit')) matter_replicator_management('Aerogel');
		else if(get_resource('Infernite').amount<get_resource('Infernite').max*0.999) matter_replicator_management('Infernite');
		else matter_replicator_management('Vitreloy');
		// build spire buildings freely now
		if(build_structure(['portal-purifier','portal-port','portal-base_camp','portal-mechbay','portal-bazaar'])) return true;
		// but still call this function to adjust balance
		if(hell_spire_buildings()) return true;
		if(hell_num('mechbay')>0 && warlord_mech_management()) return true;
		// after we've built up asphodel meadows a bit (we have some stabilizers and
		// asphodel production sucks less), stop building stuff and
		// research a few outstanding techs (purification, railway to hell)
		if(building_exists('eden','stabilizer') && get_building('eden','stabilizer').count>7 && (!has_tech('hell_spire',11) || !has_tech('hell_lake',7))) {
			// don't build on eden
			console.log('don\'t build');
		} else if(eden_build_asphodel(['eden-corruptor','eden-warehouse'],['eden-soul_engine','eden-ectoplasm_processor','eden-research_station','eden-asphodel_harvester','eden-bunker'])) return true;
		if(warlord_build_buildings_we_want()) return true;
		// continue to build some hell buildings
		if(get_power_minus_replicator()>500 && build_structure(['portal-harbor'])) return true;
		if(hell_num('harbor')>0 && build_structure(['portal-cooling_tower'])) return true;
		if(hell_num('harbor')>0 && hell_build_transports()) return true;
		if(build_structure(['portal-harbor','portal-inferno_power','portal-corpse_pile'])) return true;
		if(build_shrine()) return true;
		if(has_trait('calm') && build_structure(['city-meditation'])) return true;
		if(evolve.global.resource.Authority.max==evolve.global.resource.Authority.amount) {
			if(can_afford_arpa('monument')==100 && build_arpa_project('monument')) return true;
		}
		// wait with rune gate until we have built up asphodel meadows a bit
		// arbitrary condititions: >=9 stabilizers, >=25 corruptors?
		// 25 corruptors is too much if ghostly=2 or something
		// maybe also require a set number of magistreriums
		if(eden_num('stabilizer')>=9 && eden_num('corruptor')>=25 && eden_num('rune_gate')<100) {
			if(build_big_structure('eden-rune_gate',100)) return true;
		}
		// build a segment whenever omniscience is capped i guess
		if(resource_exists('Omniscience') && get_resource('Omniscience').amount>=get_resource('Omniscience').max*0.999) {
			if(build_big_structure('eden-rune_gate',100)) return true;
		}
		return build_crates();
	}
	// elysium
	// stop spending soul gems now i guess
	// save for elerium cannon
	// we'll destroy the fortress in no time because warlord soldier rating is bonkers
	if(true) {
		set_factory_production_percent_check_cap(['Alloy',30,'Stanene',10,'Nano',20,'Polymer',20,'Lux',10,'Furs',10]);
		tax_morale_balance(0,55,100);
		set_ocular_power(['d','t','p']);
		assign_population('Wrought_Iron',true,true);
		// before isle:
		// whenever we can build soul attractors, replicate aerogel
		// if we need to raise elerium cap for elerium cannon, replicate aerogel for elerium containment
		// replicate nanoweave for one pillbox
		// then replicate infernite until max cap, then vitreloy
		// after isle:
		// replicate aerogel for elerium containment until we have 6 spirit vacuums
		// (only if we have enough power for another spirit vacuum)
		// replicate vitreloy until we've maxed out spirit batteries
		// then replicate scarletite for soul compactor
		// then fall back to before isle stuff
		if(has_tech('palace',6) && eden_num('infuser')<25) matter_replicator_management('Graphene');
		else if(has_tech('isle',5) && eden_num('spirit_vacuum')<6 && can_afford_at_max('eden','elerium_containment','eden_elysium') && !can_afford_at_max('eden','spirit_vacuum','eden_isle') && get_power_minus_replicator()>settings.spirit_vacuum_power_buffer+spirit_vacuum_power()) matter_replicator_management('Aerogel');
		else if(has_tech('isle',5) && eden_num('spirit_vacuum')==6 && !can_afford_at_max('eden','spirit_battery','eden_isle') && eden_num('soul_compactor')==0) matter_replicator_management('Scarletite');
		else if(has_tech('isle',5) && can_afford_at_max('eden','spirit_battery','eden_isle')) matter_replicator_management('Vitreloy');
		else if(!has_tech('isle',5) && can_afford_at_max('portal','soul_attractor','prtl_pit')) matter_replicator_management('Aerogel');
		else if(has_tech('elysium',11) && !can_afford_at_max('eden','fire_support_base','eden_elysium')) matter_replicator_management('Aerogel');
		else if(has_tech('elysium',5) && eden_num('pillbox')==0) matter_replicator_management('Nanoweave');
		else if(get_resource('Infernite').amount<get_resource('Infernite').max*0.999) matter_replicator_management('Infernite');
		else matter_replicator_management('Vitreloy');
		// build spire buildings freely now
		if(build_structure(['portal-purifier','portal-port','portal-base_camp','portal-mechbay','portal-bazaar'])) return true;
		// but still call this function to adjust balance
		if(hell_spire_buildings()) return true;
		if(hell_num('mechbay')>0 && warlord_mech_management()) return true;
		// continue to build some hell buildings
		if(build_structure(['portal-minions','portal-corpse_pile'])) return true;
		if(warlord_build_buildings_we_want()) return true;
		// continue to build harbors, cooling towers, inferno reactors
		// stop building transports, bireme warships, infernal forges
		if(get_power_minus_replicator()>500 && build_structure(['portal-harbor'])) return true;
		if(hell_num('harbor')>0 && build_structure(['portal-cooling_tower'])) return true;
		// stop building harbors during spirit vacuum phase, save up cement
		if(!has_tech('isle',1) && build_structure(['portal-harbor'])) return true;
		if(build_structure(['portal-inferno_power'])) return true;
		if(build_shrine()) return true;
		if(has_trait('calm') && build_structure(['city-meditation'])) return true;
		if(evolve.global.resource.Authority.max==evolve.global.resource.Authority.amount) {
			if(can_afford_arpa('monument')==100 && build_arpa_project('monument')) return true;
		}
		// don't build the asphodel buildings that cost soul gems
		// except asphodel harvesters which are cheap
		if(eden_build_asphodel([],['eden-soul_engine','eden-asphodel_harvester','eden-bunker'])) return true;
		// survey elysium
		if(!has_tech('elysium',3)) return build_structure(['eden-survey_fields']);
		if(eden_attack_fortress()) return true;
		// elysium, continued
		if(has_tech('elysium',4)) {
			if(!has_tech('elysium',5)) return build_structure(['eden-scout_elysium']);
			if(eden_build_elysium()) return true;
			if(eden_num('elysanite_mine')>5 && build_big_structure('eden-fire_support_base',100)) return true;
		}
		// waiting game for elerium cannon and 5000 soul gems
		// soul gem income should be a bit more than 1 per in-game day, and script
		// stopped buying things for soul gems a while back
		if(has_tech('elysium',11) && !has_tech('isle',2)) {
			// build elerium containments if we can't store 250k elerium
			if(!can_afford_at_max('eden','fire_support_base','eden_elysium') && build_structure(['eden-elerium_containment'])) return true;
			// fire cannon
			if(can_afford_at_max('eden','fire_support_base','eden_elysium') && build_structure(['eden-fire_support_base'])) return true;
		}
		if(build_one(['eden-rushmore','eden-reincarnation'])) return true;
		// build north/south piers
		if(has_tech('isle',2)) {
			if(build_big_structure('eden-north_pier',10)) return true;
			if(build_big_structure('eden-south_pier',10)) return true;
			if(build_one(['eden-archive'])) return true;
		}
		// spirit vacuum stuff
		// replicate vitreloy now
		if(has_tech('isle',5) && !has_tech('palace',1)) {
			// corruptors are damn good, build them when we have a solid base
			if(eden_num('spirit_vacuum')<3 && eden_num('corruptor')<22 && build_structure(['eden-corruptor'])) return true;
			if(eden_num('spirit_vacuum')<4 && eden_num('corruptor')<25 && build_structure(['eden-corruptor'])) return true;
			if(eden_num('spirit_vacuum')>3 && eden_num('spirit_battery')>4 && build_structure(['eden-corruptor'])) return true;
			if(eden_num('spirit_vacuum')<6 && !can_afford_at_max('eden','spirit_vacuum','eden_isle') && build_structure(['eden-elerium_containment'])) return true;
			if(build_structure(['eden-spirit_battery'])) return true;
			if(build_one(['eden-soul_compactor'])) return true;
			// build spirit vacuum if we have enough spare power for another one
			if(get_power_minus_replicator()>settings.spirit_vacuum_power_buffer+spirit_vacuum_power() && build_structure(['eden-spirit_vacuum'])) return true;
			// build corruptor if we don't have enough power
			if(get_power_minus_replicator()<settings.spirit_vacuum_power_buffer+spirit_vacuum_power() && build_structure(['eden-corruptor'])) return true;
			// build eternal banks if spirit batteries are capped
			// TODO check if they're capped on another resource than money
			if(!can_afford_at_max('eden','spirit_battery','eden_isle') && build_structure(['eden-eternal_bank'])) return true;
		}
		if(has_tech('palace',1) && !has_tech('palace',2) && build_structure(['eden-scout_palace'])) return true;
		if(has_tech('palace',3) && !has_tech('palace',4)) {
			if(build_structure(['eden-eden_cement'])) return true;
			if(build_big_structure('eden-tomb',10)) return true;
			// build soul compactor if it wasn't finished earlier
			if(build_one(['eden-soul_compactor'])) return true;
		}
		if(has_tech('palace',6) && !has_tech('palace',7)) {
			// TODO depopulate reclaimers, cement workers, ghost trappers, crafters
			// for scavengers to boost graphene
			// continue to boost power to boost replicator on graphene
			if(build_structure(['portal-hell_forge','portal-inferno_power','eden-corruptor'])) return true;
			if(build_big_structure('eden-infuser',25)) return true;
			if(build_big_structure('eden-conduit',25)) return true;
		}
		if(has_tech('palace',7)) {
			// ready to reset
		}
		return build_crates();
	}
}

//----------
// launchers
//----------

// TODO when i can be bothered to make ui stuff, make a selection screen
// if we're in lone survivor or warlord, script will redirect to the correct bot
// if we chose the wrong one

// un-comment out the desired type of run

//setInterval(MAD_bot, 1000);              // setup runs
//setInterval(bioseed_bot, 1000);
//setInterval(blackhole_bot, 1000);        // farm dark energy i guess
setInterval(pillar_bot, 1000);           // farm pillars
//setInterval(ascend_bot, 1000);           // farm harmony crystals
//TODOsetInterval(demonic_infusion_bot, 1000); // farm artifacts or blood stones (very low priority, warlord exists)
//TODOsetInterval(apotheosis_bot, 1000);       // very low priority, warlord exists
//TODOsetInterval(ai_apocalypse_bot, 1000);    // farm imitations, ai cores
//TODOsetInterval(matrix_bot, 1000);           // farm (skilled) servants
//TODOsetInterval(retirement_bot, 1000);       // farm (skilled) servants
//setInterval(lone_survivor_bot, 1000);    // farm antiplasmids, phage, servants
//setInterval(warlord_bot, 800);           // farm s.plasmids, blood stones, artifacts, change hybrid custom
//TODOsetInterval(truepath_orbital_decay_kamikaze_bot,1000); // low priority
