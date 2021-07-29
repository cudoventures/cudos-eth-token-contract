# Cudos Token

### Cudos Token Smart Contract

* Is ERC20 compliant	
* Responsible for holding all tokens balances on the Cudos platform infrastructure	
* The `CudosToken` has the following properties	
  * Defines a token `name` - `CudosToken`	
  * Defines a token `symbol` - `CUDOS`	
  * Defines the number of `decimals` the token is divisible by - `18`	
  * Defines the total supply of tokens - `10 billion` tokens are created upon contract creation	
* The token has a `transfersEnabled` flag that can be toggled to enable transfers for all. Only admin addresses defined in the linked `CudosAccessControls` contract can toggle this flag.	
* Whitelisted addresses can transfer tokens even if the `transfersEnabled` flag is set to false. The whitelist is defined in the linked `CudosAccessControls` contract.	

### Cudos Vesting Contracts

* `VestingContract` is not directly based on a specific EIP but does borrow some leanings from the open-zepplin library
* Designed to work with Cudos ERC20 token contract but would support any standard ERC20 contract
* General rules are as follows:
    * Single vesting schedule per `address`
    * Schedules are defined as address, total amount, total time vested
    * User can withdraw every second and will issue allowance since last draw down
    * Cudo is in control of setting up and cancelling any vesting schedules
    * Utility methods can be called to gain insight into a beneficiaries remaining allowance and draw down rates

#### Cudos Token set-up steps

* Deploy `CudosAccessControls` from a Cudo admin account. The deployment account will be automatically granted the default admin role. 
* Deploy `CudosToken` from a Cudo account supplying the address of the access control contract 
           
## Local Installation & Testing	

Requires [Yarn](https://yarnpkg.com/en/docs/install#mac-stable) or Npm, and [NodeJs](https://nodejs.org/en/) (version 10.x upwards) globally

1. Install dependencies.	

```bash	
yarn install	
```

or

```
npm install
```
3. Run tests. 	
```bash	
npx buidler test
```

### Code Coverage	

* Code coverage and instrumentation performed by a buidler plugin - [solidity-coverage](https://github.com/sc-forks/solidity-coverage)	

* To run code coverage `npx buidler coverage` - this will produce the following:	
* HTML output in `/coverage/index.html`	
* JSON output in `./.coverage.json`	
* Terminal output

### GAS reporting

* To view GAS estimates for the project run the following:
    * In one terminal tab: `npx buidler node`
    * And in another terminal tab: `yarn test-with-gas`
