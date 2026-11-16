import test from 'node:test';
import assert from 'node:assert/strict';
import {githubLibrary, localBook, imageEntries, supportedFile} from '../comic-reader/core.mjs';
const base='https://raw.githubusercontent.com/to-shreds/Misc/main/cbz/';
const part=(name,size=24*1024*1024)=>({name,path:`cbz/${name}`,type:'file',download_url:base+name,size,sha:name});
test('local CBZ and PDF may exceed 150 MiB',()=>{
  for(const ext of ['cbz','pdf']){
    const f={name:`Book.${ext}`,size:600*1024*1024,lastModified:10};
    assert.equal(localBook(f).size,f.size);
    assert.equal(supportedFile(f.name),true);
  }
});
test('GitHub split book reassembles ordered parts into one volume',()=>{
  const parts=[part('Big Adventure.cbz.001'),part('Big Adventure.cbz.002'),part('Big Adventure.cbz.003')];
  const result=githubLibrary([...parts,part('Normal.pdf',1234)]);
  assert.equal(result.length,2);
  const b=result.find(x=>x.name.endsWith('.cbz'));
  assert.equal(b.size,72*1024*1024);
  assert.deepEqual(b.parts.map(x=>x.number),[1,2,3]);
  assert.equal(githubLibrary([parts[0],parts[2]]).length,0,'no corrupt/incomplete volumes');
  assert.equal(githubLibrary([parts[1],parts[2]]).length,0,'missing first part');
  assert.equal(githubLibrary([part('Big Adventure.cbz.000'),...parts]).length,1,'zero-based sequence allowed');
  assert.equal(githubLibrary([part('Big Adventure.cbz.001'), {...parts[1],download_url:'https://evil.test/part'}]).length,0,'no untrusted parts');
});
test('zip.js image entries filter folder junk and sort pages naturally',()=>{
  const entries=[{filename:'Nested/12.jpg',directory:false},{filename:'Nested/02.jpg',directory:false},{filename:'__MACOSX/01.jpg',directory:false},{filename:'Nested/subfolder',directory:true}];
  assert.deepEqual(imageEntries(entries).map(x=>x.filename),['Nested/02.jpg','Nested/12.jpg']);
});