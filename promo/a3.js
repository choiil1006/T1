const {chromium}=require('playwright');
(async()=>{const b=await chromium.launch();
const pg=await b.newPage({viewport:{width:1240,height:1754},deviceScaleFactor:3508/1240});
for(const k of ['A','B','C']){await pg.goto('file://'+process.cwd()+'/panel-'+k+'.html');await pg.evaluate(()=>document.fonts.ready);await pg.waitForTimeout(400);
await pg.screenshot({path:`panel-${k}-A3.png`});
await pg.emulateMedia({media:'screen'});
await pg.pdf({path:`panel-${k}-A3.pdf`,width:'297mm',height:'420mm',scale:0.905,printBackground:true,margin:{top:0,right:0,bottom:0,left:0}});}
await b.close();})();
