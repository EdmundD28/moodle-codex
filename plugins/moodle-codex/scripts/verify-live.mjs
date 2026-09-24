import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const transport=new StdioClientTransport({command:process.execPath,args:['server.mjs'],cwd:root,env:{...process.env,MOODLE_DATA_DIR:resolve(process.env.MOODLE_DATA_DIR || '../live-data')}});
const c=new Client({name:'moodle-live-verification',version:'1'});
const coursePattern=process.env.MOODLE_VERIFY_COURSE ? new RegExp(process.env.MOODLE_VERIFY_COURSE,'i') : null;
async function call(name,args={}) {
  const r=await c.callTool({name,arguments:args});
  if(r.isError) throw Error(r.content?.[0]?.text || 'Tool failed');
  return r.structuredContent;
}
async function probe(name,run){try{console.log(JSON.stringify({probe:name,ok:true,result:await run()}));}catch(e){console.log(JSON.stringify({probe:name,ok:false,error:e.message}));}}
try {
  await c.connect(transport);
  console.log(JSON.stringify({tools:(await c.listTools()).tools.map(t=>t.name)}));
  await probe('connection',async()=>{const r=await call('check_connection');return {connected:r.connected,release:r.site?.release,build:r.build,feature_set:r.feature_set};});
  const courses=(await call('list_courses')).courses;
  const candidates=coursePattern ? courses.filter(x=>coursePattern.test(x.shortname)||coursePattern.test(x.fullname)) : courses;
  const course=candidates.filter(x=>x.visible!==false).sort((a,b)=>(b.startdate??0)-(a.startdate??0))[0];
  if(!course)throw Error(coursePattern ? 'No visible course matched MOODLE_VERIFY_COURSE.' : 'No visible Moodle course is available.');
  const files=(await call('list_course_files',{course_id:course.id})).files;
  console.log(JSON.stringify({course:course.shortname,files:files.length}));
  await probe('deadline_radar',async()=>{const r=await call('get_deadline_radar',{course_ids:[course.id],days:14});return {counts:r.counts,calendar_complete:r.coverage.calendar_complete};});
  await probe('weekly_plan',async()=>{const r=await call('get_weekly_study_plan',{course_ids:[course.id],days:7});return {items:r.plan.items.length,state:r.plan.state.label};});
  await probe('study_dashboard',async()=>{const r=await call('write_study_dashboard',{course_ids:[course.id],days:7});return {html_path:r.html_path,json_path:r.json_path};});
  const pdf=files.find(f=>/\.pdf$/i.test(f.filename)&&/assignment|plc/i.test(f.filename));
  if(pdf) await probe('pdf',async()=>{const r=await call('read_course_file',{course_id:course.id,file_id:pdf.file_id,page:1,page_count:1});return {filename:pdf.filename,pages:r.content.total_pages,text_characters:r.content.pages[0].total_characters};});
  if(pdf) await probe('download',async()=>{const r=await call('download_course_file',{course_id:course.id,file_id:pdf.file_id});return {bytes:r.bytes,sha256:r.sha256};});
  const zip=files.find(f=>/\.zip$/i.test(f.filename)&&/initial|starter|code|template/i.test(f.filename));
  if(zip) await probe('zip',async()=>{const r=await call('read_course_file',{course_id:course.id,file_id:zip.file_id});const entry=r.content.entries.find(e=>/\.(?:py|cpp|c|h|dmc|txt)$/i.test(e.name));let chars=null;if(entry){const content=await call('read_course_file',{course_id:course.id,file_id:zip.file_id,zip_entry:entry.name});chars=content.content.content.total_characters;}return {filename:zip.filename,entries:r.content.entries.length,source_characters:chars};});
  await probe('forums',async()=>{
    const forums=(await call('list_course_forums',{course_id:course.id})).forums;
    const forum=forums.find(f=>f.type==='news') ?? forums[0];
    if(!forum)return {count:0};
    const discussions=await call('list_forum_discussions',{forum_id:forum.id,limit:2});
    const d=discussions.discussions?.[0];let posts=null;
    if(d){const r=await call('get_forum_posts',{discussion_id:d.discussion});posts=r.posts?.length;}
    return {count:forums.length,discussions:discussions.discussions?.length,posts,warnings:discussions.warnings};
  });
  await call('get_course_contents',{course_id:course.id});
  let assign=(await call('list_assignments',{course_ids:[course.id]})).courses.flatMap(x=>x.assignments)[0];
  // If the selected course has no standard assignment, use the first visible course that has one.
  if(!assign){for(const fallback of courses.filter(x=>x.id!==course.id&&x.visible!==false)){assign=(await call('list_assignments',{course_ids:[fallback.id]})).courses.flatMap(x=>x.assignments)[0];if(assign)break;}}
  if(assign){
    await probe('feedback',async()=>{const r=await call('get_assignment_feedback',{assignment_id:assign.id});return {available:r.feedback_available,warnings:r.warnings};});
    await probe('rubric',async()=>{const r=await call('get_grading_definition',{module_id:assign.cmid});return {areas:r.areas?.length,warnings:r.warnings};});
  } else console.log(JSON.stringify({probe:'feedback_and_rubric',skipped:'No accessible standard assignment found in the selected courses.'}));
  for(let i=0;i<2;i++)await probe('changes_'+i,async()=>{const r=await call('check_course_changes',{course_id:course.id});return {baseline_created:r.baseline_created,changes:r.changes.length,coverage:r.coverage};});
} catch(e) {console.log(JSON.stringify({fatal:e.message}));process.exitCode=1;}
finally {await c.close();}
