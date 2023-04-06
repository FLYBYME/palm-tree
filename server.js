const { ServiceBroker } = require("moleculer");

const config=require("./moleculer.config");


const broker = new ServiceBroker(config);

broker.start().then(()=>{
    broker.repl()
})