import test from 'node:test';
import assert from 'node:assert/strict';
import { supportedFile, githubBook, imageEntries, spreadStart, nextPage, previousPage } from '../comic-reader/core.mjs';
test('source types and trusted GitHub paths',()=>{
  assert.equal(supportedFile('a.CBZ'),true);assert.equal(supportedFile('a.pdf'),true);assert.equal(supportedFile('a.zip'),false);
  const good={name:'Page_01.cbz',type:'file',path:'cbz/Page_01.cbz',download_url:'https://raw.githubusercontent.com/to-shreds/Misc/main/cbz/Page_01.cbz'};
  assert.ok(githubBook(good)); assert.equal(githubBook({...good,path:'../Page_01.cbz'}),null);
  assert.equal(githubBook({...good,download_url:'https://evil.test/cbz/Page_01.cbz'}),null);
});
test('numeric page ordering works for nested archives',()=>{
  const data=['issue/010.jpg','issue/002.jpg','issue/001.jpg','__MACOSX/003.jpg','issue/.DS_Store','issue/004.png'].map(name=>({name,dir:false}));
  assert.deepEqual(imageEntries(data).map(x=>x.name),['issue/001.jpg','issue/002.jpg','issue/004.png','issue/010.jpg']);
});
test('two-up spreads preserve odd cover and stop at final page',()=>{
  assert.equal(spreadStart(2,true),1);assert.equal(nextPage(0,8,true),1);assert.equal(nextPage(1,8,true),3);assert.equal(previousPage(3,true),1);
});