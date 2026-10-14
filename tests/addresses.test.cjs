const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname,'..','Forest City Transit.html'),'utf8');
const context = {window:{}}; vm.createContext(context);
vm.runInContext(html.match(/<script id="trip-address-tools">([\s\S]*?)<\/script>/)[1],context);
const tools = context.window.FCTAddressTools;
const boullee = {label:'248 Boullee St',type:'address'};
test('full street names, abbreviations, and London suffixes identify the same address', () => {
  for (const query of ['248 Boullee Street','248 Boullee St.','248 Boullee Street, London, Ontario','248 Boullee']) {
    assert.equal(tools.resolve(query,[boullee]),boullee);
  }
});
test('a different house number or street is never accepted', () => {
  for (const label of ['248 Steele Street','248 Elgin Street','246 Boullee St','248A Boullee St','Boullee St']) {
    assert.equal(tools.matches('248 Boullee Street',{label,type:'address'}),false,label);
  }
});
test('street-only coordinates cannot resolve a numbered address', () => {
  assert.equal(tools.resolve('248 Boullee Street',[{label:'Boullee St',type:'street'}]),null);
});
test('ambiguous partial addresses need a choice rather than silently picking one', () => {
  assert.equal(tools.resolve('450 Highbury',[{label:'450 Highbury Avenue North',type:'address'},{label:'450 Highbury Avenue South',type:'address'}]),null);
});
test('landmark names resolve with a London prefix and optional street description', () => {
  const school={label:'Central Secondary School',type:'address'};
  assert.equal(tools.resolve('London Central Secondary School',[school]),school);
  const namedSchool={label:'London Central Secondary School · 509 Waterloo Street',matchText:'London Central Secondary School',type:'address'};
  assert.equal(tools.resolve('London Central Secondary School',[namedSchool]),namedSchool);
});
test('a named building can resolve by its actual street address without matching words from its name', () => {
  const school={label:'London Central Secondary School',address:'509 Waterloo Street',matchText:'London Central Secondary School',type:'address'};
  assert.equal(tools.resolve('509 Waterloo St',[school]),school);
  assert.equal(tools.resolve('509 Central St',[school]),null);
});
