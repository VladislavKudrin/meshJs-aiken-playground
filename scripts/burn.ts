import {
  BlockfrostProvider,
  mConStr,
  MeshTxBuilder,
  MeshWallet,
  resolveScriptHash,
  stringToHex,
  type UTxO,
} from "@meshsdk/core";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import validator from "../static/plutus.json";
import { applyParamsToScript } from "@meshsdk/core-csl";

const argv = await yargs(hideBin(process.argv))
  .option("t", {
    type: "string",
    describe: "Your token",
    default: "TEST",
  })
  .parse();
const provider = new BlockfrostProvider(process.env.BLOCKFROST_PROJECT_ID!);
const MNEMONIC = process.env.MNEMONIC!;

const wallet = new MeshWallet({
  networkId: 0, // 0: testnet, 1: mainnet
  fetcher: provider,
  submitter: provider,
  key: {
    type: "mnemonic",
    words: MNEMONIC.split(" "),
  },
});

const utxos = await wallet.getUtxos();
const collateral: UTxO = (await wallet.getCollateral())[0]!;
const changeAddress = wallet.getChangeAddress();

const validatorsArray = validator.validators;
const mintCBOR = applyParamsToScript(validatorsArray[0]?.compiledCode!, []);

const policyId = resolveScriptHash(mintCBOR, "V3");
const tokenName = argv.t;
const tokenNameHex = stringToHex(tokenName);

const redeemer = mConStr(1, []);

const txBuilder = new MeshTxBuilder({
  fetcher: provider,
  verbose: true,
});

const unsignedTx = await txBuilder
  .txIn(
    utxos[0]?.input.txHash!,
    utxos[0]?.input.outputIndex!,
    utxos[0]?.output.amount!,
    utxos[0]?.output.address!,
  )
  .mintPlutusScriptV3()
  .mint("-1", policyId, tokenNameHex)
  .mintingScript(mintCBOR)
  .mintRedeemerValue(redeemer)
  .changeAddress(changeAddress)
  .selectUtxosFrom(utxos)
  .txInCollateral(
    collateral.input.txHash,
    collateral.input.outputIndex,
    collateral.output.amount,
    collateral.output.address,
  )
  .setNetwork("preprod")
  .complete();

const signedTx = await wallet.signTx(unsignedTx, true);
const txHash = await wallet.submitTx(signedTx);

console.log(txHash);
