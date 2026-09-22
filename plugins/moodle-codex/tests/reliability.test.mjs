import test from 'node:test';
import assert from 'node:assert/strict';
import { MoodleClient, redactSecrets, stripHtml } from '../src/moodle-client.mjs';
import {courseContentsResult,assignmentsResult,deadlinesResult} from '../src/normalizers.mjs';
test('reject writes and parameter override before network',async()=>{
 let calls=0;const c=new MoodleClient({baseUrl:'https://example.invalid',token:'fake',fetchImpl:async()=>{calls++;}});
 for(const fn of ['mod_assign_submit_for_grading','mod_assign_save_submission','core_message_send_instant_messages','unknown']) await assert.rejects(c.call(fn),/Read-only/);
 await assert.rejects(c.call('core_webservice_get_site_info',{wsfunction:'mod_assign_submit_for_grading'}),/Reserved/);
 assert.equal(calls,0);
});
test('redacts embedded credentials and literal secret recursively',()=>{
 const r=redactSecrets({text:'failure https://example.invalid/?token=abc&x=1',nested:['a literal abc']},'abc');
 assert.ok(!JSON.stringify(r).includes('abc'));
});
test('network errors redact actual token and reject redirects',async()=>{
 const c=new MoodleClient({baseUrl:'https://example.invalid',token:'fake-secret',fetchImpl:async(u,o)=>{assert.equal(o.redirect,'error');throw Error('failed fake-secret');}});
 await assert.rejects(c.getSiteInfo(),e=>!e.message.includes('fake-secret'));
});
test('long descriptions have explicit truncation and full-text recovery',()=>{
 const description='x'.repeat(2100)+' deadline'; const input=[{modules:[{description}]}];
 const a=courseContentsResult(input).sections[0].modules[0];assert.equal(a.description_truncated,true);assert.equal(a.description.length,2000);
 const b=courseContentsResult(input,true).sections[0].modules[0];assert.equal(b.description,description);assert.equal(b.description_truncated,false);
});
test('preserves links, paragraph boundaries and attachment metadata',()=>{
 assert.match(stripHtml('<p>one</p><p><a href="https://example.invalid/a">two</a></p>'),/one\n.*two \(https:/);
 const a=assignmentsResult({courses:[{assignments:[{intro:'a'.repeat(2200),introattachments:[{filename:'brief.pdf',fileurl:'https://example.invalid/a'}]}]}]},true).courses[0].assignments[0];
 assert.equal(a.intro.length,2200);assert.equal(a.introattachments[0].filename,'brief.pdf');
});
test('pagination sends supplied cursor and retains server cursor',async()=>{
 const c=new MoodleClient({baseUrl:'https://example.invalid',token:'fake',fetchImpl:async(u,o)=>{assert.equal(o.body.get('aftereventid'),'77');return {ok:true,json:async()=>({events:[{id:88}],lastid:88})}}});
 const r=deadlinesResult(await c.getUpcomingDeadlines({from:1,to:100,limit:1,afterEventId:77}));assert.equal(r.lastid,88);
});

