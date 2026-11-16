const {chromium}=require('playwright');
(async()=>{const b=await chromium.launch();const sc=+process.argv[2]||1;
const pg=await b.newPage({viewport:{width:1240,height:1754},deviceScaleFactor:sc});
for(const k of ['A','B','C']){await pg.goto('file://'+process.cwd()+'/panel-'+k+'.html');await pg.evaluate(()=>document.fonts.ready);await pg.waitForTimeout(300);
await pg.screenshot({path:sc>1?`panel-${k}.png`:`/tmp/claude-0/-home-user-T1/736b6a9f-dd31-5e79-a9b4-0e9c223a8265/scratchpad/pv-${k}.png`});}
await b.close();})();
