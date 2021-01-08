const {BN, constants, expectEvent, expectRevert, ether, balance} = require('@openzeppelin/test-helpers');
const {ZERO_ADDRESS} = constants;

require('chai').should();

const {
  shouldBehaveLikeERC20,
  shouldBehaveLikeERC20Transfer,
  shouldBehaveLikeERC20Approve
} = require('./ERC20.behavior');

const CudosAccessControls = artifacts.require('CudosAccessControls');
const CudosToken = artifacts.require('CudosToken');
const ForceEther = artifacts.require('ForceEther');

contract('CudosToken', function ([_, cudos, partner, anotherAccount, otherWhitelistAdmin, otherPartner, random, ...otherAccounts]) {
  const NAME = 'CudosToken';
  const SYMBOL = 'CUDOS';
  const DECIMALS = 18;
  const TEN_BILLION = new BN(10000000000);
  const initialSupply = TEN_BILLION.mul(new BN(10).pow(new BN(DECIMALS)));

  const ONE_TOKEN = new BN(1).mul(new BN(10).pow(new BN(DECIMALS)));

  beforeEach(async function () {
    // cudos is added as a admin doing construction
    this.accessControls = await CudosAccessControls.new({from: cudos});

    this.token = await CudosToken.new(this.accessControls.address, cudos, {from: cudos});

    await this.accessControls.addAdminRole(otherWhitelistAdmin, {from: cudos});

    await this.accessControls.addWhitelistRole(cudos, {from: cudos});
    await this.accessControls.addWhitelistRole(partner, {from: cudos});
    await this.accessControls.addWhitelistRole(otherPartner, {from: cudos});

    await this.token.toggleTransfers({from: cudos});
  });

  it('has a name', async function () {
    (await this.token.name()).should.equal(NAME);
  });

  it('has a symbol', async function () {
    (await this.token.symbol()).should.equal(SYMBOL);
  });

  it('has 18 decimals', async function () {
    (await this.token.decimals()).should.be.bignumber.equal('18');
  });

  it('assigns the initial total supply to the creator', async function () {
    const totalSupply = await this.token.totalSupply();
    const creatorBalance = await this.token.balanceOf(cudos);

    creatorBalance.should.be.bignumber.equal(totalSupply);

    await expectEvent.inConstruction(this.token, 'Transfer', {
      from: ZERO_ADDRESS,
      to: cudos,
      value: totalSupply
    });
  });

  it('Reverts during construction when initial supply recipient is zero', async function () {
    await expectRevert(
      CudosToken.new(this.accessControls.address, ZERO_ADDRESS, {from: cudos}),
      'CudosToken: Invalid recipient of the initial supply'
    )
  })

  shouldBehaveLikeERC20('ERC20', initialSupply, cudos, partner, anotherAccount);

  describe('decrease allowance', function () {
    describe('when the spender is not the zero address', function () {
      const spender = partner;

      function shouldDecreaseApproval(amount) {
        describe('when there was no approved amount before', function () {
          it('reverts', async function () {
            await expectRevert(this.token.decreaseAllowance(spender, amount, {from: cudos}),
              'ERC20: decreased allowance below zero'
            );
          });
        });

        describe('when the spender had an approved amount', function () {
          const approvedAmount = amount;

          beforeEach(async function () {
            ({logs: this.logs} = await this.token.approve(spender, approvedAmount, {from: cudos}));
          });

          it('emits an approval event', async function () {
            const {logs} = await this.token.decreaseAllowance(spender, approvedAmount, {from: cudos});

            expectEvent.inLogs(logs, 'Approval', {
              owner: cudos,
              spender: spender,
              value: new BN(0)
            });
          });

          it('decreases the spender allowance subtracting the requested amount', async function () {
            await this.token.decreaseAllowance(spender, approvedAmount.subn(1), {from: cudos});

            (await this.token.allowance(cudos, spender)).should.be.bignumber.equal('1');
          });

          it('sets the allowance to zero when all allowance is removed', async function () {
            await this.token.decreaseAllowance(spender, approvedAmount, {from: cudos});
            (await this.token.allowance(cudos, spender)).should.be.bignumber.equal('0');
          });

          it('reverts when more than the full allowance is removed', async function () {
            await expectRevert(
              this.token.decreaseAllowance(spender, approvedAmount.addn(1), {from: cudos}),
              'ERC20: decreased allowance below zero'
            );
          });
        });
      }

      describe('when the sender has enough balance', function () {
        const amount = initialSupply;

        shouldDecreaseApproval(amount);
      });

      describe('when the sender does not have enough balance', function () {
        const amount = initialSupply.addn(1);

        shouldDecreaseApproval(amount);
      });
    });
  });

  describe('increase allowance', function () {
    const amount = initialSupply;

    describe('when the spender is not the zero address', function () {
      const spender = partner;

      describe('when the sender has enough balance', function () {
        it('emits an approval event', async function () {
          const {logs} = await this.token.increaseAllowance(spender, amount, {from: cudos});

          expectEvent.inLogs(logs, 'Approval', {
            owner: cudos,
            spender: spender,
            value: amount
          });
        });

        describe('when there was no approved amount before', function () {
          it('approves the requested amount', async function () {
            await this.token.increaseAllowance(spender, amount, {from: cudos});

            (await this.token.allowance(cudos, spender)).should.be.bignumber.equal(amount);
          });
        });

        describe('when the spender had an approved amount', function () {
          beforeEach(async function () {
            await this.token.approve(spender, new BN(1), {from: cudos});
          });

          it('increases the spender allowance adding the requested amount', async function () {
            await this.token.increaseAllowance(spender, amount, {from: cudos});

            (await this.token.allowance(cudos, spender)).should.be.bignumber.equal(amount.addn(1));
          });
        });
      });

      describe('when the sender does not have enough balance', function () {
        const amount = initialSupply.addn(1);

        it('emits an approval event', async function () {
          const {logs} = await this.token.increaseAllowance(spender, amount, {from: cudos});

          expectEvent.inLogs(logs, 'Approval', {
            owner: cudos,
            spender: spender,
            value: amount
          });
        });

        describe('when there was no approved amount before', function () {
          it('approves the requested amount', async function () {
            await this.token.increaseAllowance(spender, amount, {from: cudos});

            (await this.token.allowance(cudos, spender)).should.be.bignumber.equal(amount);
          });
        });

        describe('when the spender had an approved amount', function () {
          beforeEach(async function () {
            await this.token.approve(spender, new BN(1), {from: cudos});
          });

          it('increases the spender allowance adding the requested amount', async function () {
            await this.token.increaseAllowance(spender, amount, {from: cudos});

            (await this.token.allowance(cudos, spender)).should.be.bignumber.equal(amount.addn(1));
          });
        });
      });
    });

    describe('when the spender is the zero address', function () {
      const spender = ZERO_ADDRESS;

      it('reverts', async function () {
        await expectRevert(
          this.token.increaseAllowance(spender, amount, {from: cudos}), 'ERC20: approve to the zero address'
        );
      });
    });
  });

  describe('_transfer', function () {
    shouldBehaveLikeERC20Transfer('ERC20', cudos, partner, initialSupply, function (from, to, amount) {
      return this.token.transfer(to, amount, {from: cudos});
    });

    context('when transfers are disabled', function () {
      beforeEach(async function () {
        this.token = await CudosToken.new(this.accessControls.address, cudos, {from: cudos});
        (await this.token.transfersEnabled()).should.equal(false);
      });

      it('reverts as not authorised to transfer via whitelist', async function () {
        (await this.accessControls.hasWhitelistRole(cudos)).should.equal(true);

        await this.token.transfer(anotherAccount, ONE_TOKEN, {from: cudos}); // ensure anotherAccount has a balance

        (await this.token.balanceOf(anotherAccount)).should.be.bignumber.equal(ONE_TOKEN);

        (await this.accessControls.hasWhitelistRole(anotherAccount)).should.equal(false);
        await expectRevert(
          this.token.transfer(cudos, ONE_TOKEN, {from: anotherAccount}), 'Caller can not currently transfer'
        );
      });
    });

    context('when transfers are enabled', function () {

      it('should allow transfer for non-whitelisted token owner', async function () {
        (await this.accessControls.hasWhitelistRole(cudos)).should.equal(true);
        await this.token.transfer(anotherAccount, ONE_TOKEN, {from: cudos}); // ensure anotherAccount has a balance

        (await this.token.balanceOf(anotherAccount)).should.be.bignumber.equal(ONE_TOKEN);

        (await this.accessControls.hasWhitelistRole(anotherAccount)).should.equal(false);
        await this.token.transfer(cudos, ONE_TOKEN, {from: anotherAccount});
      });
    });
  });

  describe('_transferFrom', function () {
    context('when transfers are disabled', function () {
      beforeEach(async function () {
        this.token = await CudosToken.new(this.accessControls.address, cudos, {from: cudos});
        (await this.token.transfersEnabled()).should.equal(false);
      });

      it('transferFrom via whitelisted caller (who has been approved the required allowance)', async function () {
        await this.token.transfer(anotherAccount, ONE_TOKEN, {from: cudos}); // ensure anotherAccount has a balance

        await this.token.approve(partner, ONE_TOKEN, {from: anotherAccount});
        (await this.token.allowance(anotherAccount, partner)).should.be.bignumber.equal(ONE_TOKEN);

        (await this.accessControls.hasWhitelistRole(partner)).should.equal(true);

        // partner can send tokens as whitelisted and approved
        await this.token.transferFrom(anotherAccount, cudos, 1, {from: partner});
      });

      it('reverts when caller is not whitelisted despite having an approved allowance', async function () {
        await this.token.transfer(anotherAccount, ONE_TOKEN, {from: cudos}); // ensure anotherAccount has a balance

        await this.token.approve(random, ONE_TOKEN, {from: anotherAccount});
        (await this.token.allowance(anotherAccount, random)).should.be.bignumber.equal(ONE_TOKEN);

        (await this.accessControls.hasWhitelistRole(random)).should.equal(false);
        await expectRevert(
          this.token.transferFrom(anotherAccount, cudos, 1, {from: random}),
          'Caller can not currently transfer'
        );
      });
    });

    context('when transfers are enabled', function () {
      it('transfers from a non-whitelisted caller', async function () {
        await this.token.transfer(anotherAccount, ONE_TOKEN, {from: cudos});

        await this.token.approve(random, ONE_TOKEN, {from: anotherAccount});
        (await this.token.allowance(anotherAccount, random)).should.be.bignumber.equal(ONE_TOKEN);

        (await this.accessControls.hasWhitelistRole(random)).should.equal(false);
        await this.token.transferFrom(anotherAccount, cudos, 1, {from: random});
      });
    });
  });

  describe('_approve', function () {
    shouldBehaveLikeERC20Approve('ERC20', cudos, partner, initialSupply, function (owner, spender, amount) {
      return this.token.approve(spender, amount, {from: cudos});
    });
  });

  describe('toggling transfers', function () {
    context('from authorized account', function () {
      it('reverts when trying to toggle twice', async function() {
        await expectRevert(
          this.token.toggleTransfers({from: cudos}),
          "CudosToken.toggleTransfers: Only can be toggled on once"
        );
      });
    });

    context('from unauthorized account', function () {
      const from = partner;

      it('reverts', async function () {
        (await this.token.transfersEnabled()).should.equal(true);

        await expectRevert(this.token.toggleTransfers({from}),
          'CudosToken.toggleTransfers: Only admin'
        );

        (await this.token.transfersEnabled()).should.equal(true);
      });
    });
  });

  describe('whitelist admin access control via modifier', function () {
    context('from unauthorized account', function () {
      const from = partner;

      it('reverts', async function () {
        await expectRevert(this.token.toggleTransfers({from}),
          'CudosToken.toggleTransfers: Only admin'
        );
      });
    });
  });

  describe('withdrawing stuck ether', async function () {
    it('fails when not admin whitelisted', async function () {
      await expectRevert.unspecified(this.token.withdrawStuckEther(random, {from: random}));
    });

    it('fails when address is zero', async function () {
      await expectRevert.unspecified(this.token.withdrawStuckEther(ZERO_ADDRESS, {from: cudos}));
    });

    it('force ether can still be withdrawn', async function () {
      // Force ether into it
      const forceEther = await ForceEther.new({value: ether('1'), from: cudos});
      (await balance.current(forceEther.address)).should.be.bignumber.eq(ether('1'));
      await forceEther.destroyAndSend(this.token.address);

      (await balance.current(forceEther.address)).should.be.bignumber.eq(ether('0'));
      (await balance.current(this.token.address)).should.be.bignumber.eq(ether('1'));

      await this.token.withdrawStuckEther(cudos, {from: cudos});

      (await balance.current(forceEther.address)).should.be.bignumber.eq('0');
      (await balance.current(this.token.address)).should.be.bignumber.eq(ether('0'));
    });
  });

  describe('updating access controls', async function () {
    it('can update as admin', async function () {
      (await this.token.accessControls()).should.be.equal(this.accessControls.address);
      await this.token.updateAccessControls(random, {from: cudos});
      (await this.token.accessControls()).should.be.equal(random);
    });

    it('reverts when not admin', async function () {
      await expectRevert(
        this.token.updateAccessControls(random, {from: random}),
        "CudosToken.updateAccessControls: Only admin"
      );
    });

    it('reverts when zero address', async function () {
      await expectRevert(
        this.token.updateAccessControls(ZERO_ADDRESS, {from: cudos}),
        "CudosToken.updateAccessControls: Invalid address provided"
      );
    });
  });
});
