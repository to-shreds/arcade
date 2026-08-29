class ArcadePitchProcessor extends AudioWorkletProcessor{
  static get parameterDescriptors(){return[{name:'ratio',defaultValue:1,minValue:.45,maxValue:1.9,automationRate:'k-rate'}]}
  constructor(){super();this.buffer=new Float32Array(32768);this.write=0;this.read=0;this.ready=false}
  process(inputs,outputs,parameters){
    const input=inputs[0]&&inputs[0][0];
    const output=outputs[0]&&outputs[0][0];
    if(!output)return true;
    if(!input){output.fill(0);return true}
    const ratio=parameters.ratio[0]||1;
    const size=this.buffer.length;
    if(!this.ready){this.read=(this.write-3072+size)%size;this.ready=true}
    for(let i=0;i<output.length;i++){
      this.buffer[this.write]=input[i]||0;
      this.write=(this.write+1)%size;
      const a=Math.floor(this.read);
      const b=(a+1)%size;
      const f=this.read-a;
      output[i]=this.buffer[a]*(1-f)+this.buffer[b]*f;
      this.read=(this.read+ratio)%size;
      const distance=(this.write-this.read+size)%size;
      if(distance<640||distance>8192)this.read=(this.write-3072+size)%size;
    }
    return true
  }
}
class ArcadeRecorderProcessor extends AudioWorkletProcessor{
  constructor(){super();this.recording=false;this.port.onmessage=e=>{this.recording=e.data==='start'}}
  process(inputs){
    const input=inputs[0]&&inputs[0][0];
    if(this.recording&&input){const copy=new Float32Array(input);this.port.postMessage(copy,[copy.buffer])}
    return true
  }
}
registerProcessor('arcade-pitch',ArcadePitchProcessor);
registerProcessor('arcade-recorder',ArcadeRecorderProcessor);
