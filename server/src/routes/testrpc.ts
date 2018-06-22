import * as express from 'express'
import { exec } from 'child_process'
import config from '../config'
import * as fs from 'fs'
import * as Web3 from 'web3'
import * as contract from 'truffle-contract'

const router = express.Router()

/* Port number for currently running "testrpc" */
let port = '';

const basePath = '../smart-contracts/build/contracts';

const getContractByName = (jsonFileName:string, provider:any) => {

	let json = JSON.parse(String(fs.readFileSync(`${basePath}/${jsonFileName}`)));

	let standardToken = contract(json);
	standardToken.setProvider(provider);
	return standardToken;
};

const deployContracts = () => {
	return new Promise( (resolve, reject) => {
		try {
			let url = `http://localhost:${port}`;
			let provider = new Web3.providers.HttpProvider(url);
			let web3 = new Web3(provider);

			web3.eth.getAccounts(async (err:Error, accounts:any) => {

				let from = accounts[0];

				let StandardToken = getContractByName('StandardToken.json', provider);
				let standardTokenInstance = await StandardToken.new({from: from, gas: 4712388});

				let HumanStandardToken = getContractByName('HumanStandardToken.json', provider);

				await HumanStandardToken.detectNetwork();

				HumanStandardToken.link('StandardToken', standardTokenInstance.address);
				
				let humanStandardTokenInstance = await HumanStandardToken.new(100000000,"GoNetwork",1,"$GOT", {from: from, gas: 4712388});

				let NettingChannelLibrary = getContractByName('NettingChannelLibrary.json', provider);
				await NettingChannelLibrary.detectNetwork();

				NettingChannelLibrary.link('StandardToken', standardTokenInstance.address);

				let nettingChannelLibrary = await NettingChannelLibrary.new({from: from, gas: 4712388});
				
				let NettingChannelContract = getContractByName('NettingChannelContract.json', provider);
				await NettingChannelContract.detectNetwork();

				NettingChannelContract.link('NettingChannelLibrary', nettingChannelLibrary.address);
				
				let ChannelManagerLibrary = getContractByName('ChannelManagerLibrary.json', provider);
				await ChannelManagerLibrary.detectNetwork();

				ChannelManagerLibrary.link('NettingChannelLibrary', nettingChannelLibrary.address);
				let channelManagerLibrary = await ChannelManagerLibrary.new({from: from, gas: 4712388});

				let ChannelManagerContract = getContractByName('ChannelManagerContract.json', provider);
				await ChannelManagerContract.detectNetwork();

				ChannelManagerContract.link('ChannelManagerLibrary', channelManagerLibrary.address);

				let channelManagerContract = await ChannelManagerContract.new('0x423b5F62b328D0D6D44870F4Eee316befA0b2dF5', humanStandardTokenInstance.address, {from: from, gas: 4712388});

				resolve();
			});
		} catch (e) {
			console.log(e);
			reject(e);
		}
	});
};


router.post('/start', (req, res) => {
	const params = req.body.params;
	
	let arr = params.split(/ +/);
	let portIndex = arr.indexOf('-p');
	if (portIndex === -1) {
		portIndex = arr.indexOf('--port');
	}
	port = (portIndex === -1) ? '8545' : arr[portIndex + 1];

	exec(`${config.testrpcCmd} ${params} | tee ${config.testrpcOut}`);

	deployContracts().then(() => {
		res.json({ success: true });
	}).catch( (e) => {
		res.status(500).json({ success: false, message: e.message });
	});
});

router.post('/stop', (req, res) => {
	if (!port) {
		res.json({success: false});
		return;
	}

	exec("kill `lsof -i :" + port + " | tail -n 1 | awk  '{print $2}'`");
	port = '';
	res.json({success: true});
});

export default router;