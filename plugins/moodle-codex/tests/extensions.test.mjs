import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileCatalog, downloadUrl, downloadFile, parseFile, saveDownload, MAX_DOWNLOAD } from '../src/files.mjs';
import { courseRecords, compareRecords, checkChanges } from '../src/changes.mjs';
import { MoodleClient } from '../src/moodle-client.mjs';
import { registerExtendedTools } from '../src/extended-tools.mjs';

const base = 'https://moodle.example';
const file = { filename:'brief.txt',fileurl:base+'/webservice/pluginfile.php/1/a',filesize:5 };
const client = fetchImpl => new MoodleClient({baseUrl:base,token:'private-token',fetchImpl});
const temporary = () => mkdtemp(join(tmpdir(), 'moodle-codex-test-'));
const sections = description => [{id:1,name:'Week 1',modules:[{id:2,name:'Brief',description,contents:[{type:'file',filename:'a.pdf',fileurl:base+'/a',timemodified:1}]}]}];
const assignments = due => ({courses:[{id:9,assignments:[{id:3,name:'A1',duedate:due}]}],warnings:[]});

test('catalog IDs remain stable across metadata updates and exclude external links',()=>{
  const a=sections('a'), b=sections('a'); b[0].modules[0].contents[0].timemodified=2;
  b[0].modules[0].contents.push({type:'url',filename:'x',fileurl:'https://external.example'});
  assert.equal(fileCatalog(a)[0].file_id,fileCatalog(b)[0].file_id); assert.equal(fileCatalog(b).length,1);
});
test('download URL blocks cross-origin, credentials, HTTP and unrelated endpoints',()=>{
  for(const url of ['https://evil.example/pluginfile.php/1','http://moodle.example/pluginfile.php/1',base+'/admin/delete.php','https://user:pass@moodle.example/pluginfile.php/1'])
    assert.throws(()=>downloadUrl(base,url,'private-token'));
  const url=downloadUrl(base,base+'/pluginfile.php/1?token=old&unknown=x','private-token');
  assert.equal(url.pathname,'/webservice/pluginfile.php/1');assert.equal(url.searchParams.get('token'),'private-token');assert.equal(url.searchParams.has('unknown'),false);
});
test('download accepts bounded data but rejects oversized declarations and streaming bodies',async()=>{
  const c=client(async(u,o)=>{assert.equal(o.redirect,'error');return new Response('hello');});
  assert.equal((await downloadFile(c,file)).toString(),'hello');
  await assert.rejects(downloadFile(c,{...file,filesize:MAX_DOWNLOAD+1}),/limit/);
  await assert.rejects(downloadFile(client(async()=>new Response('small',{headers:{'content-length':String(MAX_DOWNLOAD+1)}})),file),/limit/);
  await assert.rejects(downloadFile(client(async()=>new Response(Buffer.alloc(MAX_DOWNLOAD+1))),file),/limit/);
});
test('download errors redact credentials and reject login pages',async()=>{
  await assert.rejects(downloadFile(client(async()=>{throw Error('private-token');}),file),e=>!e.message.includes('private-token'));
  await assert.rejects(downloadFile(client(async()=>new Response('<html>login</html>',{headers:{'content-type':'text/html'}})),file),/login/);
});
test('saved download cannot use a hostile filename as a path',async()=>{
  const dir=await temporary();const saved=await saveDownload(Buffer.from('x'),{filename:'../../evil.exe'},dir);
  assert.equal(saved.path,join(dir,saved.sha256+'.bin')); assert.equal((await readFile(saved.path)).toString(),'x');
});
test('text parsing offers recoverable pagination, no execution, and rejects binary',async()=>{
  const r=await parseFile(Buffer.from('123456'),'a.py',{limit:3});assert.equal(r.text,'123');assert.equal(r.next_offset,3);
  assert.equal((await parseFile(Buffer.from('123456'),'a.py',{offset:3,limit:3})).text,'456');
  await assert.rejects(parseFile(Buffer.from('MZ'),'a.exe'),/Unsupported/);
  await assert.rejects(parseFile(Buffer.from([0xff]),'a.txt'),/UTF-8/);
  await assert.rejects(parseFile(Buffer.from('not PDF'),'a.pdf'),/signature/);
});
function pdfFixture() {
  const stream='BT /F1 12 Tf 20 50 Td (Assignment deadline Friday) Tj ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let text='%PDF-1.4\n';const offsets=[0];
  objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(text));text+=`${i+1} 0 obj\n${o}\nendobj\n`;});
  const xref=Buffer.byteLength(text);text+=`xref\n0 6\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(text);
}
test('PDF text extraction, page bounds and text pagination survive complete cleanup',async()=>{
  const bytes=pdfFixture(), r=await parseFile(bytes,'a.pdf',{page:1,page_count:1,limit:10});
  assert.equal(r.total_pages,1);assert.equal(r.pages[0].text,'Assignment');assert.equal(r.pages[0].next_offset,10);
  assert.match((await parseFile(bytes,'a.pdf',{offset:10})).pages[0].text,/deadline Friday/);
  await assert.rejects(parseFile(bytes,'a.pdf',{page:2}),/out of range/);
});
// Minimal stored ZIP fixture, including a correct CRC32, independent of parser implementation.
function zip(name,body) {
  const data=Buffer.from(body), n=Buffer.from(name);let crc=0xffffffff;
  for(const b of data){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}crc=(crc^0xffffffff)>>>0;
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(n.length,26);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt32LE(crc,16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(n.length,28);
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+n.length,12);end.writeUInt32LE(local.length+n.length+data.length,16);
  return Buffer.concat([local,n,data,central,n,end]);
}
test('ZIP listing and one source member are readable without extraction; traversal rejected',async()=>{
  const bytes=zip('src/main.py','print("never executed")');
  const listing=await parseFile(bytes,'a.zip');assert.equal(listing.entries[0].name,'src/main.py');
  const r=await parseFile(bytes,'a.zip',{zip_entry:'src/main.py'});assert.equal(r.content.text,'print("never executed")');
  await assert.rejects(parseFile(zip('../escape.py','x'),'a.zip'),/invalid relative path/);
  await assert.rejects(parseFile(bytes,'a.zip',{zip_entry:'missing.py'}),/not found/);
});
test('change comparison detects wording, deadlines, metadata and no-longer-visible resources',()=>{
  const before=courseRecords(sections('old'),assignments(10));const next=sections('new');next[0].modules[0].contents[0].timemodified=2;
  const after=courseRecords(next,assignments(20));const changes=compareRecords(before,after);
  assert.equal(changes.length,2); assert.ok(changes.find(x=>x.id==='assignment:3').fields.some(f=>f.field==='duedate'));
  assert.equal(compareRecords(before,{},false).some(c=>c.id==='assignment:3'),false);
  assert.equal(compareRecords(before,{}).find(c=>c.id==='module:2').type,'no_longer_visible');
});
test('snapshots persist, avoid false removals on warnings, detect recovery and isolate accounts',async()=>{
  const dir=await temporary();let due=10,warning=false,user=1;
  const c={baseUrl:base,token:'private-token',getSiteInfo:async()=>({userid:user}),getCourseContents:async()=>sections('text'),listAssignments:async()=>warning?{courses:[],warnings:[{message:'denied'}]}:assignments(due)};
  assert.equal((await checkChanges(c,9,dir)).baseline_created,true);
  assert.equal((await checkChanges(c,9,dir)).changes.length,0);
  warning=true; assert.equal((await checkChanges(c,9,dir)).changes.length,0);
  warning=false;due=20;assert.equal((await checkChanges(c,9,dir)).changes[0].id,'assignment:3');
  user=2;assert.equal((await checkChanges(c,9,dir)).baseline_created,true);
});
test('initially unavailable assignments establish a later baseline, not false additions',async()=>{
  const dir=await temporary();let available=false;
  const c={baseUrl:base,getSiteInfo:async()=>({userid:1}),getCourseContents:async()=>sections('x'),listAssignments:async()=>{if(!available)throw Error('denied');return assignments(10);}};
  await checkChanges(c,9,dir);available=true;const r=await checkChanges(c,9,dir);assert.equal(r.changes.length,0);assert.equal(r.assignment_baseline_created,true);
});
test('corrupt baseline and failed course calls never overwrite snapshots',async()=>{
  const dir=await temporary();const c={baseUrl:base,getSiteInfo:async()=>({userid:1}),getCourseContents:async()=>sections('x'),listAssignments:async()=>assignments(10)};
  await checkChanges(c,9,dir);const path=join(dir,(await readdir(dir))[0]);const before=await readFile(path,'utf8');
  c.getCourseContents=async()=>{throw Error('network failed');};await assert.rejects(checkChanges(c,9,dir));assert.equal(await readFile(path,'utf8'),before);
  await writeFile(path,'broken');await assert.rejects(checkChanges(c,9,dir),/unreadable/);assert.equal(await readFile(path,'utf8'),'broken');
});
test('extended tool contracts use IDs correctly and propagate permissions',async()=>{
  const handlers={};const calls=[];const c={token:'private-token',call:async(fn,params)=>{calls.push([fn,params]);return {discussions:[],warnings:[]};},getSubmissionStatus:async()=>({feedback:{grade:3,plugins:[{text:'Good'}]}})};
  registerExtendedTools({registerTool:(name,spec,handler)=>handlers[name]=handler},{withClient:fn=>fn(c),success:r=>r,annotations:{readOnlyHint:true}});
  await handlers.get_grading_definition({module_id:44});assert.deepEqual(calls[0],['core_grading_get_definitions',{cmids:[44],areaname:'submissions',activeonly:true}]);
  await handlers.list_forum_discussions({forum_id:4,page:2,limit:10});assert.equal(calls[1][1].page,2);
  assert.equal((await handlers.get_assignment_feedback({assignment_id:2})).feedback.grade,3);
  c.call=async()=>{throw Error('core_grading_get_definitions failed (accessexception)');};await assert.rejects(handlers.get_grading_definition({module_id:44}),/accessexception/);
});
