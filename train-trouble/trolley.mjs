// Direct choices with disclosed facts. Outcomes carry no moral score.
const option=(id,label,outcome,summary=label,risk)=>({id,label,outcome,summary,...(risk?{risk}:{})});
const stay=(outcome,label='Keep the main track')=>option('main',label,outcome);
const turn=(outcome,label='Switch to the side track')=>option('side',label,outcome);
const scene=(id,family,title,story,facts,main,side,options)=>({id,family,title,story,facts,routes:[{label:'MAIN',description:main},{label:'SIDE',description:side}],options});
const emergency='A runaway trolley is approaching a fork. Its brakes have failed. You can move the switch, but you cannot stop it or warn anyone in time.';

const scenes=[
scene('fork-five','numbers','The fork',emergency,
 ['Five people are trapped on the main track.','One person is trapped on the side track.','Everyone is a stranger. Both routes are certain to be fatal.'],
 'Five trapped people','One trapped person',[
 stay('The trolley stays on the main track. The five people die. The person on the side track survives.'),
 turn('The trolley takes the side track. The one person dies. The five people on the main track survive.')]),
scene('fork-equal','numbers','Two routes, equal numbers',emergency,
 ['Two strangers are trapped on each track.','Whichever route the trolley takes, those two people will be seriously injured.','Nobody has a better chance of escaping.','A rescue team is close by. Everyone injured will be treated and recover.'],
 'Two trapped people','Two trapped people',[
 stay('The trolley stays on the main track. Two people are seriously injured; the two on the side track survive.'),
 turn('The trolley takes the side track. Two people are seriously injured; the two on the main track survive.')]),
scene('fork-group','numbers','The bigger crowd',emergency,
 ['Eight strangers are trapped on the main track.','Three strangers are trapped on the side track.','There is no third track or working emergency brake. Everyone on the chosen track will die.'],
 'Eight trapped people','Three trapped people',[
 stay('The trolley stays on the main track. Eight people die. The three on the side track survive.'),
 turn('The trolley takes the side track. Three people die. The eight on the main track survive.')]),
scene('fork-one','numbers','One person on each track',emergency,
 ['One stranger is trapped on each track.','You do not know anything else about either person.','Moving the switch changes who is hit, but not how many people are hit.','Anyone hit will be seriously injured. A rescue team is close by, and everyone injured will be treated and recover.'],
 'One trapped stranger','One trapped stranger',[
 stay('You leave the switch alone. The person on the main track is seriously injured. The other person survives.'),
 turn('You move the switch. The person on the side track is seriously injured. The other person survives.')]),

scene('friend-side','familiar','A familiar face',emergency,
 ['Five strangers are trapped on the main track.','Your friend is trapped on the side track.','Everyone on the chosen track will die.'],
 'Five strangers','Your friend',[
 stay('The trolley stays on the main track. The five strangers die. Your friend survives.'),
 turn('The trolley takes the side track. Your friend dies. The five strangers survive.')]),
scene('friend-main','familiar','Your friend is with the group',emergency,
 ['Five people are trapped on the main track, including your friend.','One stranger is trapped on the side track.','Nobody on either track can get free. Everyone on the chosen track will die.'],
 'Five people, including your friend','One stranger',[
 stay('The trolley stays on the main track. All five people, including your friend, die. The stranger survives.'),
 turn('The trolley takes the side track. The stranger dies. All five people on the main track survive.')]),
scene('neighbor-side','familiar','The person next door',emergency,
 ['Three strangers are trapped on the main track.','A neighbor who has often helped your family is trapped on the side track.','Being familiar does not change anyone’s chance of surviving a hit.','Anyone hit will be seriously injured. A rescue team is close by, and everyone injured will be treated and recover.'],
 'Three strangers','Your helpful neighbor',[
 stay('The trolley stays on the main track. Three strangers are seriously injured. Your neighbor survives.'),
 turn('The trolley takes the side track. Your neighbor is seriously injured. The three strangers survive.')]),
scene('known-both','familiar','People you know on both tracks',emergency,
 ['Two friends are trapped on the main track.','One friend is trapped on the side track.','You care about all three. Everyone on the chosen track will be seriously injured.','A rescue team is close by. Everyone injured will be treated and recover.'],
 'Two friends','One friend',[
 stay('The trolley stays on the main track. Your two friends there are seriously injured. Your friend on the side track survives.'),
 turn('The trolley takes the side track. Your friend there is seriously injured. Your two friends on the main track survive.')]),

scene('caused-side','responsibility','The broken brake',emergency,
 ['Five innocent bystanders are trapped on the main track.','The worker on the side track deliberately broke the brake.','The worker cannot fix the brake now. Anyone hit will die.'],
 'Five bystanders','The worker who broke the brake',[
 stay('The trolley stays on the main track. The five bystanders die. The worker survives.'),
 turn('The trolley takes the side track. The worker dies. The five bystanders survive.')]),
scene('accident-side','responsibility','An honest mistake',emergency,
 ['Five bystanders are trapped on the main track.','The worker on the side track accidentally damaged the brake.','The worker was following the instructions they were given.','Anyone hit will be seriously injured. A rescue team is close by, and everyone injured will be treated and recover.'],
 'Five bystanders','A worker who made an honest mistake',[
 stay('The trolley stays on the main track. The five bystanders are seriously injured. The worker survives.'),
 turn('The trolley takes the side track. The worker is seriously injured. The five bystanders survive.')]),
scene('you-caused-it','responsibility','Your switch mistake',emergency,
 ['Your earlier switch mistake sent the trolley toward three workers on the main track.','One uninvolved worker is trapped on the side track.','You can change its route now, but a hit will be fatal on either track.'],
 'Three workers endangered by your mistake','One uninvolved worker',[
 stay('The trolley remains on the route from your earlier mistake. The three workers die. The uninvolved worker survives.'),
 turn('The trolley takes the side track. The uninvolved worker dies. The three workers on the main track survive.')]),
scene('rescuer-side','responsibility','The rescuer',emergency,
 ['Four people are trapped on the main track.','One person on the side track got stuck while trying to rescue them.','The rescue failed. There is no more time for another attempt.','Anyone hit will be seriously injured. A rescue team is close by, and everyone injured will be treated and recover.'],
 'Four trapped people','The person who tried to rescue them',[
 stay('The trolley stays on the main track. Four people are seriously injured. The rescuer survives.'),
 turn('The trolley takes the side track. The rescuer is seriously injured. The four people survive.')]),

scene('escape-chance','risk','They might escape',emergency,
 ['Five people on the main track have an 80% chance (8 chances in 10) of getting free together.','If they fail, all five will die.','One trapped person on the side track has no chance of escaping and will die if hit.'],
 'Five people: 80% chance (8 chances in 10) of escape','One person: certain death if hit',[
 option('main','Take the 80% escape chance','The group will either escape together or remain trapped.','Take the group’s escape chance',{chance:.8,success:'All five people get free before the trolley arrives. Nobody dies.',failure:'The escape attempt fails. The five people die. The person on the side track survives.'}),
 turn('The trolley takes the side track. The trapped person dies. The five people on the main track are safe.')]),
scene('weak-bridge','risk','The weak bridge',
 'The trolley is heading toward four trapped workers. A side track crosses a bridge that might hold it.',
 ['Staying on the main track will seriously injure the four workers.','The side bridge has a 75% chance (3 chances in 4) of carrying the trolley safely into an empty yard.','If the bridge breaks, the driver will be seriously injured. The four workers will still be safe.','Anyone hit will be seriously injured. A rescue team is close by, and everyone injured will be treated and recover.'],
 'Four workers: certain serious injury','A bridge: 75% chance (3 chances in 4) of holding',[
 stay('The trolley stays on the main track. The four workers are seriously injured. The driver survives.'),
 option('side','Try the bridge','The bridge may hold or break.','Try the bridge',{chance:.75,success:'The bridge holds. The trolley reaches the empty yard. Everyone survives.',failure:'The bridge breaks. The driver is seriously injured. The four workers survive.'})]),
scene('uncertain-signal','risk','A signal you cannot fully trust',emergency,
 ['The main-track signal reports three trapped people, but it is only correct half the time (50%).','If the report is wrong, the main track is empty.','The side track definitely has one trapped person. Both tracks are too far away to check.','Anyone hit will be seriously injured. A rescue team is close by, and everyone injured will be treated and recover.'],
 'Three people, or an empty track','One person, definitely',[
 option('main','Trust that the main track might be empty','The report may be right or wrong.','Leave the route unchanged',{chance:.5,success:'The signal report was wrong. The main track is empty and nobody is seriously injured.',failure:'The report was right. Three people are seriously injured on the main track. The person on the side track survives.'}),
 turn('The trolley takes the side track. The one person is seriously injured. Nobody on the main track is hit.')]),
scene('brake-gamble','risk','One last brake',
 'Five people are trapped ahead. You can divert toward one other person, or try an untested emergency brake.',
 ['The emergency brake has a 30% chance (3 chances in 10) of stopping the trolley in time.','If the brake fails, it will be too late to change tracks and the five people will die.','Diverting now certainly saves the five and kills the one person on the side track.'],
 'Five trapped people','One trapped person',[
 option('brake','Try the emergency brake','The brake may stop the trolley.','Try the brake',{chance:.3,success:'The brake works. The trolley stops and everyone survives.',failure:'The brake fails. The five people on the main track die. The person on the side track survives.'}),
 turn('The trolley takes the side track. The one person dies. The five people survive.')]),

scene('hospital-water','town','Power or water',
 'An empty runaway freight trolley will hit one of two buildings. Everyone has left both buildings.',
 ['The main route destroys the hospital’s generator. Operations must stop until tomorrow.','The side route destroys the town’s water pumps. Homes lose clean tap water for two days.','Backup supplies keep people alive either way, but you cannot protect both buildings.'],
 'Hospital generator','Town water pumps',[
 stay('The hospital generator is destroyed. Operations are postponed, and staff move patients to backup care. The town keeps its water.'),
 turn('The water pumps are destroyed. The town delivers bottled water for two days. The hospital keeps its power.')]),
scene('medicine-fuel','town','The two deliveries',
 'A runaway trolley will destroy one of two parked freight cars. Nobody is near them.',
 ['The main-track car carries medicine needed by a clinic tomorrow. A replacement arrives in three days.','The side-track car carries fuel for homes during a freezing night. Replacement fuel arrives tomorrow.','The clinic can move its patients, and the town can open a crowded warm shelter.'],
 'Clinic medicine','Heating fuel',[
 stay('The medicine is destroyed. The clinic transfers its patients for three days. Homes keep their heating fuel.'),
 turn('The heating fuel is destroyed. Families spend the freezing night in a crowded shelter. The clinic receives its medicine.')]),
scene('floodgate-shelter','town','The storm is coming',
 'An empty freight trolley is rolling toward the town’s storm equipment.',
 ['The main route destroys a floodgate motor. Twenty homes will flood after everyone evacuates.','The side route destroys the town shelter. Evacuated families must travel to another town.','There is time to evacuate either way. Nobody will be trapped in the buildings.'],
 'Floodgate motor','Emergency shelter',[
 stay('The motor is destroyed. Twenty homes flood, but everyone is evacuated. The shelter remains open.'),
 turn('The shelter is destroyed. The floodgate protects the homes, and evacuated families travel to another town.')]),
scene('ambulance-road','town','A road or a warehouse',
 'An empty runaway trolley will knock down one of two structures.',
 ['The main route blocks the only direct road to the hospital for a day. Ambulances must take a 25-minute detour.','The side route destroys a food warehouse used by 200 families. Replacement food arrives in two days.','Emergency services have been warned. Nobody is inside either structure.'],
 'Hospital access road','Community food warehouse',[
 stay('The direct road is blocked. Ambulances take the detour for a day. The food warehouse remains intact.'),
 turn('The food warehouse is destroyed. Families share emergency food for two days. The hospital road stays open.')]),

scene('warning-heard','warning','One group will hear the trolley',emergency,
 ['Three workers on the main track are wearing hearing protection and cannot hear a warning.','Two workers on the side track will hear the trolley and can step off safely.','You know both side-track workers have clear escape paths. The main-track workers will die if hit.'],
 'Three workers who cannot hear','Two workers with clear escape paths',[
 stay('The main-track workers do not hear the trolley. Three people die. The side-track workers remain safe.'),
 turn('The trolley takes the side track. Both workers hear it and step away. Nobody is hit.')]),
scene('warning-ignored','warning','They ignored the warning',emergency,
 ['Four people are trapped on the main track after ignoring a closed-track sign.','One worker is trapped on the side track while doing an approved repair.','Everyone on the chosen track will be seriously injured. Ignoring a sign did not make escape possible.','A rescue team is close by. Everyone injured will be treated and recover.'],
 'Four people who ignored a sign','One worker following the rules',[
 stay('The trolley stays on the main track. The four people are seriously injured. The repair worker survives.'),
 turn('The trolley takes the side track. The repair worker is seriously injured. The four people survive.')]),
scene('protective-shelter','warning','The shelter beside the track',emergency,
 ['Four people are trapped on the main track with no shelter.','The person on the side track can duck into a reinforced shelter before the trolley arrives.','The shelter has been inspected and will protect them. The four people on the main track will die if hit.'],
 'Four people without shelter','One person with a safe shelter',[
 stay('The trolley stays on the main track. The four people die. The other person remains safe.'),
 turn('The trolley takes the side track. The person ducks into the shelter. Nobody is hit.')]),
scene('escape-too-late','warning','A clear path, but not enough time',emergency,
 ['Three people on the main track have a clear escape path, but need ten seconds to reach it.','The trolley arrives in four seconds.','One person is trapped on the side track. Everyone hit will be seriously injured.','A rescue team is close by. Everyone injured will be treated and recover.'],
 'Three people who need ten seconds','One trapped person',[
 stay('Four seconds pass. The three people have not reached safety and are seriously injured. The person on the side track survives.'),
 turn('The trolley takes the side track. The trapped person is seriously injured. The three people reach safety.')]),

scene('pets-one-many','animals','The runaway pet trolley',
 'An empty park trolley is rolling toward two groups of animals. The animals cannot move out of its path.',
 ['The main track has five dogs in a stalled rescue trailer.','The side track has one dog in another stalled trailer.','A collision will seriously injure the animals in that trailer. No people are at risk.','Veterinarians are close by. Every injured dog will be treated and recover.'],
 'Five rescued dogs','One rescued dog',[
 stay('The trolley hits the main-track trailer. Five dogs are seriously injured. The dog on the side track survives.'),
 turn('The trolley hits the side-track trailer. One dog is seriously injured. The five dogs survive.')]),
scene('pet-or-person','animals','A person and an animal shelter',emergency,
 ['One person is trapped on the main track.','The side track leads into an animal shelter containing twelve cats. All staff have evacuated.','The chosen collision will cause serious injuries to the person or the cats.','Rescue workers and veterinarians are close by. The person or injured cats will be treated and recover.'],
 'One trapped person','Twelve cats in a shelter',[
 stay('The trolley stays on the main track. The person is seriously injured. The cats remain safe.'),
 turn('The trolley hits the animal shelter. The twelve cats are seriously injured. The person survives.')]),
scene('your-pet','animals','The animal you know',
 'An empty park trolley cannot stop. Two animal carriers are stuck on the tracks.',
 ['The main carrier holds three unfamiliar dogs.','The side carrier holds your own dog.','The dogs cannot escape. A collision will seriously injure them. No people are near either track.','Veterinarians are close by. Every injured dog will be treated and recover.'],
 'Three unfamiliar dogs','Your dog',[
 stay('The trolley hits the main carrier. Three dogs are seriously injured. Your dog survives.'),
 turn('The trolley hits the side carrier. Your dog is seriously injured. The three unfamiliar dogs survive.')]),
scene('habitat-or-yard','animals','A pond or a playground',
 'An empty freight trolley will break through the barrier at the end of one track.',
 ['The main track leads into an empty playground and destroys its equipment.','The side track spills a tank of harmless-to-people dye into a wildlife pond. The animals need rescue and treatment.','The playground can be rebuilt. Rescue teams can save the animals, but restoring their pond will take a year.'],
 'An empty playground','A wildlife pond',[
 stay('The trolley wrecks the empty playground. Nobody is hurt, and the pond stays safe.'),
 turn('The trolley spills dye into the pond. The animals are rescued for treatment, but their habitat is badly damaged. The playground stays intact.')]),

scene('promise-return','promise','You promised',emergency,
 ['Five strangers are trapped on the main track.','One person is trapped on the side track. Earlier, you promised that person you would keep their track safe.','Everyone on the chosen track will die.'],
 'Five strangers','One person you promised to protect',[
 stay('You keep the trolley off the promised track. Five people die. The person you promised survives.'),
 turn('You change the route despite your promise. One person dies. The five strangers survive.')]),
scene('random-request','promise','A request for a fair draw',emergency,
 ['One person is trapped on each track.','Before the trolley arrived, both people asked for a random draw if this happened.','You can honor their request or choose a track yourself. The draw gives each track a 50% chance (one chance in two).','Anyone hit will be seriously injured. A rescue team is close by, and everyone injured will be treated and recover.'],
 'One person','One person',[
 stay('You choose the main track. The person there is seriously injured. The other person survives.'),
 turn('You choose the side track. The person there is seriously injured. The other person survives.'),
 option('draw','Use their 50/50 draw','The draw will choose which track is used.','Honor the random-draw request',{chance:.5,success:'The draw selects the main track. That person is seriously injured. The person on the side track survives.',failure:'The draw selects the side track. That person is seriously injured. The person on the main track survives.'})]),
scene('volunteer','promise','The volunteer',emergency,
 ['Four people are trapped on the main track.','The person on the side track has clearly said they want you to divert the trolley to save the four.','Anyone hit will die. There is no safer third route.'],
 'Four trapped people','One person who volunteered',[
 stay('The trolley stays on the main track. Four people die. The volunteer survives.'),
 turn('The trolley takes the side track. The volunteer dies. The four people survive.')]),
scene('refused','promise','They asked you not to switch',emergency,
 ['Four people are trapped on the main track.','The person on the side track has clearly asked you not to divert toward them.','Everyone on the chosen track will be seriously injured. There is no third route.','A rescue team is close by. Everyone injured will be treated and recover.'],
 'Four trapped people','One person asking you not to switch',[
 stay('You leave the switch alone. The four people are seriously injured. The person on the side track survives.'),
 turn('You divert the trolley. The person on the side track is seriously injured. The four people survive.')]),

scene('cake-museum','mischief','The cake emergency',
 'An empty delivery trolley is rolling toward two things the town really wanted to keep.',
 ['The main track holds the town’s giant birthday cake.','The side track holds a museum’s only dinosaur model.','Nobody is near either object. The cake is delicious; the dinosaur is irreplaceable.'],
 'A giant birthday cake','A rare dinosaur model',[
 stay('The trolley ploughs through the cake. Frosting rains over the station. The dinosaur stays in one piece.'),
 turn('The trolley hits the dinosaur model. Its enormous head lands in a flower bed. The cake arrives safely.')]),
scene('silent-bells','mischief','Wake the town',
 'An empty trolley is headed toward an outdoor stage. You can divert it into the bell tower’s padded service track.',
 ['The main route destroys a school’s stage and cancels tomorrow’s show.','The side route safely stops the trolley, but rings every bell at 3 a.m.','Nobody will be injured on either route. The town has 2,000 sleeping residents.'],
 'The school stage','The very loud bell tower',[
 stay('The stage is wrecked and tomorrow’s show is cancelled. The town sleeps through the crash.'),
 turn('The trolley stops safely. Every bell rings. Two thousand sleepy people sit bolt upright in bed.')]),
scene('slime-library','mischief','Slime at the station',
 'An empty fairground trolley is about to knock over one of two wagons.',
 ['The main wagon holds a school library’s books.','The side wagon holds 400 tubs of bright-green slime beside the mayor’s open-top car.','Nobody is in the way. Replacing the books will take months.'],
 'The school’s books','Slime beside the mayor’s car',[
 stay('The books tumble into a puddle and are ruined. The mayor’s car stays clean.'),
 turn('The slime wagon bursts. The mayor’s car becomes an enormous green jelly. The books stay dry.')]),
scene('game-or-grandma','mischief','The last delivery',
 'An empty parcel trolley has lost its brakes at the delivery depot.',
 ['The main track holds your long-awaited new game console.','The side track holds a stranger’s handmade gift from their grandmother. It took her a year to make.','Neither parcel can be moved in time. Nobody is at risk.'],
 'Your new game console','A stranger’s handmade family gift',[
 stay('The trolley crushes your game console. The stranger receives the handmade gift.'),
 turn('The trolley destroys the handmade gift. Your game console arrives safely.')])
];

function freeze(value){if(value&&typeof value==='object'){for(const v of Object.values(value))freeze(v);Object.freeze(value);}return value;}
export const TROLLEY_SCENARIOS=freeze(scenes);
const byId=new Map(TROLLEY_SCENARIOS.map(s=>[s.id,s]));
export function getScenario(id){return byId.get(id)||null;}
const clone=value=>JSON.parse(JSON.stringify(value));
function rng(seed){let n=seed>>>0;return()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296;};}
function orderFor(seed){
 const random=rng(seed),families=[...new Set(scenes.map(s=>s.family))];
 const shuffle=a=>{for(let i=a.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
 shuffle(families);const groups=families.map(f=>shuffle(scenes.filter(s=>s.family===f).map(s=>s.id))),order=[];
 for(let round=0;round<4;round++)for(const group of groups)order.push(group[round]);
 return order;
}
export function createTrolleySession(seed=1){
 if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw new Error('Invalid trolley seed');
 return {schema:1,seed:seed>>>0,order:orderFor(seed),index:0,phase:'choice',history:[],timed:false};
}
export function getCurrentScenario(session){return getScenario(session?.order?.[session?.index]);}
// The picture follows the resolved action, including a random draw or a working brake.
export function getTrolleyRoute(session){
 if(session?.phase!=='outcome')return 'waiting';
 const result=session.history?.[session.index];if(!result)return 'waiting';
 if(result.optionId==='brake')return result.riskRoll<result.chance?'stopped':'main';
 if(result.optionId==='draw')return result.riskRoll<result.chance?'main':'side';
 return result.optionId==='side'?'side':'main';
}
function resultFor(session,scenario,opt){
 const result={scenarioId:scenario.id,optionId:opt.id,title:scenario.title,choice:opt.label,outcome:opt.outcome};
 if(opt.risk){const roll=rng((session.seed^Math.imul(session.index+1,2654435761)^Math.imul(scenario.options.indexOf(opt)+1,2246822519))>>>0)();result.riskRoll=roll;result.chance=opt.risk.chance;result.outcome=roll<opt.risk.chance?opt.risk.success:opt.risk.failure;}
 return result;
}
export function validateTrolleySession(raw){
 if(!raw||raw.schema!==1||!Number.isInteger(raw.seed)||raw.seed<0||raw.seed>0xffffffff)throw new Error('Invalid trolley session');
 const expected=orderFor(raw.seed);
 if(JSON.stringify(raw.order)!==JSON.stringify(expected)||!Number.isInteger(raw.index)||raw.index<0||raw.index>=expected.length||!['choice','outcome','complete'].includes(raw.phase)||typeof raw.timed!=='boolean'||!Array.isArray(raw.history))throw new Error('Invalid trolley progress');
 const length=raw.phase==='choice'?raw.index:raw.index+1;
 if(raw.history.length!==length||(raw.phase==='complete'&&raw.index!==expected.length-1))throw new Error('Invalid trolley decision history');
 for(let i=0;i<raw.history.length;i++){
  const previous=raw.history[i],scenario=getScenario(expected[i]),opt=scenario.options.find(o=>o.id===previous?.optionId);
  const expectedResult=opt&&resultFor({...raw,index:i},scenario,opt);
  if(!expectedResult||Object.keys(previous).sort().join('|')!==Object.keys(expectedResult).sort().join('|')||Object.keys(expectedResult).some(key=>previous[key]!==expectedResult[key]))throw new Error('Trolley outcome does not match its disclosed choice');
 }
 return clone({schema:1,seed:raw.seed,order:expected,index:raw.index,phase:raw.phase,history:raw.history,timed:raw.timed});
}
export function chooseTrolley(raw,optionId){
 const session=validateTrolleySession(raw);if(session.phase!=='choice')throw new Error('This decision is already complete');
 const scenario=getCurrentScenario(session),opt=scenario.options.find(o=>o.id===optionId);if(!opt)throw new Error('Choose one of the shown routes');
 session.history.push(resultFor(session,scenario,opt));session.phase='outcome';return session;
}
export function nextTrolley(raw){
 const session=validateTrolleySession(raw);if(session.phase!=='outcome')throw new Error('Make the current decision first');
 if(session.index===session.order.length-1)session.phase='complete';else{session.index++;session.phase='choice';}return session;
}
