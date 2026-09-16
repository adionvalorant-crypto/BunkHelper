/* BunkHelper layout patch loader. Keeps the proven app logic and fixes the page geometry without touching Firebase data. */
const style = document.createElement('style');
style.id = 'bunkhelper-layout-patch';
style.textContent = `
html,body{width:100%;min-width:0;overflow-x:hidden}
body{margin:0!important}
.topbar{width:100vw!important;left:0!important;right:0!important}
.layout{display:block!important;width:100%!important;min-height:100vh!important}
.sidebar{position:fixed!important;left:0!important;top:74px!important;bottom:0!important;width:236px!important;height:auto!important;overflow-y:auto!important;overflow-x:hidden!important}
.content{display:block!important;position:relative!important;margin-left:236px!important;width:calc(100% - 236px)!important;max-width:none!important;min-width:0!important;padding:104px 36px 48px!important}
.wrap{display:block!important;width:100%!important;max-width:1400px!important;margin:0 auto!important;min-width:0!important}
.head{display:flex!important;width:100%!important;align-items:flex-start!important;justify-content:space-between!important;gap:22px!important}
.head>div:first-child{flex:1 1 auto!important;min-width:0!important}
.head h1{max-width:none!important}
.actions{flex:0 0 auto!important}
[data-view]{width:100%!important;min-width:0!important}
.grid{width:100%!important;min-width:0!important}
.stats{grid-template-columns:repeat(4,minmax(0,1fr))!important}
.two,.tools{grid-template-columns:minmax(0,1fr) minmax(0,1fr)!important}
.card{width:100%!important;min-width:0!important}
.timetable-grid{grid-template-columns:repeat(3,minmax(0,1fr))!important}
.subject-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}
.update-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}
.fields{grid-template-columns:repeat(2,minmax(0,1fr))!important}
.section{min-width:0!important}
.subject-result,.subject-card,.update-card,.day{min-width:0!important}
.result-name,.subject-head h3,.update-card-head h3{overflow-wrap:anywhere!important}
#today-list,#mini,#subjects,#week,#subject-setup,#update-grid,#history-list,#import-list{width:100%!important;min-width:0!important}
/* Keep the help panel inside the sidebar; it must never become page content. */
.sidebar .help{position:relative!important;max-width:100%!important}
/* Dashboard result copy stays clean. */
.section .muted{overflow-wrap:anywhere!important}
@media(max-width:1000px){
  .sidebar{top:74px!important;bottom:auto!important;width:100%!important;height:57px!important;padding:7px 10px!important;overflow-x:auto!important;overflow-y:hidden!important}
  .nav{flex-direction:row!important;white-space:nowrap!important}
  .help{display:none!important}
  .content{margin-left:0!important;width:100%!important;padding:145px 22px 36px!important}
  .stats{grid-template-columns:repeat(2,minmax(0,1fr))!important}
  .two,.tools{grid-template-columns:minmax(0,1fr)!important}
  .timetable-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}
  .subject-grid,.update-grid{grid-template-columns:minmax(0,1fr)!important}
}
@media(max-width:650px){
  .content{padding:140px 14px 28px!important}
  .head{display:block!important}
  .actions{margin-top:14px!important;justify-content:flex-start!important}
  .stats{grid-template-columns:repeat(2,minmax(0,1fr))!important}
  .timetable-grid{grid-template-columns:minmax(0,1fr)!important}
  .fields{grid-template-columns:minmax(0,1fr)!important}
  .field.full{grid-column:auto!important}
}
`;
document.head.appendChild(style);

const cleanResultLabels = () => {
  document.querySelectorAll('.section .muted, .results-list .muted, h2, p, span').forEach(el => {
    if (!el.childElementCount && /combined\s+normal\s*\+\s*tutorial/i.test(el.textContent || '')) {
      el.textContent = 'Your attendance';
    }
  });
};
cleanResultLabels();
new MutationObserver(cleanResultLabels).observe(document.body,{subtree:true,childList:true,characterData:true});

import('https://raw.githubusercontent.com/adionvalorant-crypto/BunkHelper/2f75cbfc571091a1c8e4ba96efcd282febc133e2/app-fixed.js');
