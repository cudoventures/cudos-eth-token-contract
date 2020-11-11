const moment = require('moment');

const {BN, time, expectEvent, expectRevert, constants} = require('@openzeppelin/test-helpers');
const {latest} = time;

require('chai').should();

const VestingContract = artifacts.require('VestingContractWithFixedTime');
const ActualVestingContract = artifacts.require('VestingContract');
const CudosToken = artifacts.require('CudosToken');
const CudosAccessControls = artifacts.require('CudosAccessControls');

contract('VestingContract', function ([_, cudos, random, beneficiary1, beneficiary2, beneficiary3]) {
  const DECIMALS = 18;
  const TEN_BILLION = new BN(10000000000);
  const INITIAL_SUPPLY = TEN_BILLION.mul(new BN(10).pow(new BN(DECIMALS)));

  const TEN_THOUSAND_TOKENS = new BN(10000).mul(new BN(10).pow(new BN(DECIMALS)));
  const FIVE_THOUSAND_TOKENS = new BN(5000).mul(new BN(10).pow(new BN(DECIMALS)));
  const _3333_THOUSAND_TOKENS = new BN(3333).mul(new BN(10).pow(new BN(DECIMALS)));

  const _100days = 100;
  const _7days = 7;
  const _10days = 10;
  const _1day = 1;

  const PERIOD_ONE_DAY_IN_SECONDS = new BN('86400');

  const fromCudos = {from: cudos};
  const fromRandom = {from: random};

  beforeEach(async () => {
    // cudos is added as a admin doing construction
    this.accessControls = await CudosAccessControls.new({from: cudos});

    this.token = await CudosToken.new(this.accessControls.address, cudos, fromCudos);

    // Ensure transfer are enabled for all for this test
    await this.token.toggleTransfers(fromCudos);

    // Assert the token is constructed correctly
    const creatorBalance = await this.token.balanceOf(cudos);
    creatorBalance.should.be.bignumber.equal(INITIAL_SUPPLY);

    // Construct new staking contract
    this.vestingContract = await VestingContract.new(this.token.address, this.accessControls.address, fromCudos);

    // Ensure vesting contract approved to move tokens
    await this.token.approve(this.vestingContract.address, INITIAL_SUPPLY, fromCudos);

    // Ensure allowance set for vesting contract
    const vestingAllowance = await this.token.allowance(cudos, this.vestingContract.address);
    vestingAllowance.should.be.bignumber.equal(INITIAL_SUPPLY);
  });

  it('should return token address', async () => {
    const token = await this.vestingContract.token();
    token.should.be.equal(this.token.address);
  });

  it('reverts when trying to create the contract with zero address token', async () => {
    await expectRevert.unspecified(VestingContract.new(constants.ZERO_ADDRESS, this.accessControls.address, fromCudos));
  });

  context('reverts', async () => {
    describe('createVestingSchedule() reverts when', async () => {
      it('specifying a zero address beneficiary', async () => {
        await expectRevert(
          givenAVestingSchedule({
            beneficiary: constants.ZERO_ADDRESS,
            ...fromCudos
          }),
          'Beneficiary cannot be empty'
        );
      });

      it('specifying a zero vesting amount', async () => {
        await expectRevert(
          givenAVestingSchedule({
            amount: 0,
            ...fromCudos
          }),
          'Amount cannot be empty'
        );
      });

      it('specifying a zero duration', async () => {
        await expectRevert(
          givenAVestingSchedule({
            duration: 0,
            ...fromCudos
          }),
          'Duration cannot be empty'
        );
      });

      it('trying to overwrite an inflight schedule', async () => {
        await givenAVestingSchedule(fromCudos);
        await expectRevert(
          givenAVestingSchedule(fromCudos),
          'Schedule already in flight'
        );
      });

      it('token transfers are disabled', async () => {
        await this.token.toggleTransfers(fromCudos);
        (await this.token.transfersEnabled()).should.be.equal(false);

        await expectRevert(
          givenAVestingSchedule(fromCudos),
          'Caller can not currently transfer'
        );
      });

      it('specifying a cliff greater than duration', async () => {
        await expectRevert(
          givenAVestingSchedule({
            duration: 1,
            cliff: 2,
            ...fromCudos
          }),
          'VestingContract.createVestingSchedule: Cliff can not be bigger than duration'
        );
      });

      it('not admin', async () => {
        await expectRevert(
          givenAVestingSchedule({from: random}),
          'VestingContract.createVestingSchedule: Only admin'
        );
      });
    });

    describe('drawDown() reverts when', async () => {
      it('no schedule is in flight', async () => {
        await expectRevert(
          this.vestingContract.drawDown(),
          'There is no schedule currently in flight'
        );
      });

      it('a beneficiary has no remaining balance', async () => {
        await givenAVestingSchedule(fromCudos);

        // fast forward 15 days (past the end of the schedule so that all allowance is withdrawn)
        this._15DaysAfterScheduleStart = (await latest()).add(PERIOD_ONE_DAY_IN_SECONDS.mul(new BN('15')));
        await this.vestingContract.fixTime(this._15DaysAfterScheduleStart, fromCudos);

        await this.vestingContract.drawDown({from: beneficiary1});
        (await this.token.balanceOf(beneficiary1)).should.be.bignumber.equal(TEN_THOUSAND_TOKENS);

        await expectRevert(
          this.vestingContract.drawDown({from: beneficiary1}),
          'Nothing to withdraw'
        );
      });

      it('the allowance for a particular second has been exceeded (two calls in the same block scenario)', async () => {
        this.now = await latest();

        await givenAVestingSchedule({
          start: this.now,
          ...fromCudos
        });

        // fast forward 8 days
        this._8DaysAfterScheduleStart = this.now.add(PERIOD_ONE_DAY_IN_SECONDS.mul(new BN('8')));
        await this.vestingContract.fixTime(this._8DaysAfterScheduleStart, fromCudos);

        await this.vestingContract.drawDown({from: beneficiary1});
        (await this.token.balanceOf(beneficiary1)).should.be.bignumber.not.equal(TEN_THOUSAND_TOKENS);

        await expectRevert(
          this.vestingContract.drawDown({from: beneficiary1}),
          'Nothing to withdraw'
        );
      });

      it('transfers have been disabled', async () => {
        this.now = await latest();

        await givenAVestingSchedule({
          start: this.now,
          ...fromCudos
        });

        // fast forward 8 days
        this._8DaysAfterScheduleStart = this.now.add(PERIOD_ONE_DAY_IN_SECONDS.mul(new BN('8')));
        await this.vestingContract.fixTime(this._8DaysAfterScheduleStart, fromCudos);

        // disable transfers
        await this.token.toggleTransfers(fromCudos);

        await expectRevert(
          this.vestingContract.drawDown({from: beneficiary1}),
          'Caller can not currently transfer'
        );
      });
    });

    describe('updateAccessControls() reverts when', async () => {
      it('not admin', async () => {
        await expectRevert(
          this.vestingContract.updateAccessControls(this.accessControls.address, fromRandom),
          'VestingContract.updateAccessControls: Only admin'
        );

        await this.vestingContract.updateAccessControls(this.accessControls.address, fromCudos);
      });
    });
  });

  describe('single schedule - incomplete draw down', async () => {
    beforeEach(async () => {
      this.now = await latest();
      await this.vestingContract.fixTime(this.now, fromCudos);
      this.transaction = await givenAVestingSchedule({
        start: this.now,
        ...fromCudos
      });
    });

    it('vesting contract balance should equal vested tokens when called direct', async () => {
      const tokenBalance = await this.token.balanceOf(this.vestingContract.address);
      tokenBalance.should.be.bignumber.equal(TEN_THOUSAND_TOKENS);
    });

    it('vesting contract balance should equal vested tokens when proxied through', async () => {
      const tokenBalance = await this.vestingContract.tokenBalance();
      tokenBalance.should.be.bignumber.equal(TEN_THOUSAND_TOKENS);

      const tokenBalanceDirect = await this.token.balanceOf(this.vestingContract.address);
      tokenBalanceDirect.should.be.bignumber.equal(tokenBalance);
    });

    it('should be able to get my balance', async () => {
      const {_remainingBalance} = await this.vestingContract.vestingScheduleForBeneficiary(beneficiary1);
      _remainingBalance.should.be.bignumber.equal(TEN_THOUSAND_TOKENS);
    });

    it('correctly emits ScheduleCreated log', async () => {
      expectEvent(this.transaction, 'ScheduleCreated', {
        _beneficiary: beneficiary1,
        _amount: TEN_THOUSAND_TOKENS.toString(),
        _start: this.now.toString(),
        _duration: _10days.toString()
      });
    });

    it('vestingScheduleForBeneficiary()', async () => {
      const start = new BN(this.now.toString());
      const totalDuration = new BN(`${_10days}`).mul(PERIOD_ONE_DAY_IN_SECONDS);
      const end = start.add(totalDuration);
      await validateVestingScheduleForBeneficiary(beneficiary1, {
        start,
        end,
        amount: TEN_THOUSAND_TOKENS,
        totalDrawn: '0',
        lastDrawnAt: '0',
        drawDownRate: TEN_THOUSAND_TOKENS.div(totalDuration),
        remainingBalance: TEN_THOUSAND_TOKENS
      });
    });

    it('lastDrawDown()', async () => {
      const {_lastDrawnAt} = await this.vestingContract.vestingScheduleForBeneficiary(beneficiary1);
      _lastDrawnAt.should.be.bignumber.equal('0');
    });

    it('PERIOD_ONE_DAY_IN_SECONDS()', async () => {
      const PERIOD_ONE_DAY_IN_SECONDS = await this.vestingContract.PERIOD_ONE_DAY_IN_SECONDS();
      PERIOD_ONE_DAY_IN_SECONDS.should.be.bignumber.equal('86400');
    });

    it('validateAvailableDrawDownAmount()', async () => {
      // move forward 1 day
      const _1DayInTheFuture = this.now.add(PERIOD_ONE_DAY_IN_SECONDS.mul(new BN('1')));
      await this.vestingContract.fixTime(_1DayInTheFuture, fromCudos);

      await validateAvailableDrawDownAmount(beneficiary1, {
        amount: '999999999999999993600',
      });
    });

    describe('single drawn down', async () => {
      beforeEach(async () => {
        this._1DayInTheFuture = this.now.add(PERIOD_ONE_DAY_IN_SECONDS.mul(new BN('1')));
        await this.vestingContract.fixTime(this._1DayInTheFuture, fromCudos);
        this.transaction = await this.vestingContract.drawDown({from: beneficiary1});
      });

      it('should emit DrawDown events', async () => {
        expectEvent(this.transaction, 'DrawDown', {
          _beneficiary: beneficiary1,
          _amount: '999999999999999993600',
          _time: this._1DayInTheFuture.toString()
        });
      });

      it('should move tokens to beneficiary', async () => {
        (await this.token.balanceOf(beneficiary1)).should.be.bignumber.equal('999999999999999993600');
      });

      it('should reduce validateAvailableDrawDownAmount()', async () => {
        const _amount = await this.vestingContract.availableDrawDownAmount(beneficiary1);
        _amount.should.be.bignumber.equal('0');
      });

      it('should update vestingScheduleForBeneficiary()', async () => {
        const expectedTotalDrawn = new BN('999999999999999993600');

        const start = new BN(this.now.toString());
        const totalDuration = new BN(`${_10days}`).mul(PERIOD_ONE_DAY_IN_SECONDS);
        const end = start.add(totalDuration);
        await validateVestingScheduleForBeneficiary(beneficiary1, {
          start,
          end,
          amount: TEN_THOUSAND_TOKENS,
          totalDrawn: expectedTotalDrawn,
          lastDrawnAt: this._1DayInTheFuture.toString(),
          drawDownRate: TEN_THOUSAND_TOKENS.div(totalDuration),
          remainingBalance: TEN_THOUSAND_TOKENS.sub(expectedTotalDrawn)
        });
      });
    });

    describe('completes drawn down in several attempts', async () => {
      describe('after 1 day', async () => {
        beforeEach(async () => {
          this._1DayAfterScheduleStart = this.now.add(PERIOD_ONE_DAY_IN_SECONDS.mul(new BN('1')));
          this.expectedTotalDrawnAfter1Day = new BN('999999999999999993600');
          await this.vestingContract.fixTime(this._1DayAfterScheduleStart, fromCudos);
          this.transaction = await this.vestingContract.drawDown({from: beneficiary1});
        });

        it('some tokens issued', async () => {
          const start = new BN(this.now.toString());
          const totalDuration = new BN(`${_10days}`).mul(PERIOD_ONE_DAY_IN_SECONDS);
          const end = start.add(totalDuration);
          await validateVestingScheduleForBeneficiary(beneficiary1, {
            start,
            end,
            amount: TEN_THOUSAND_TOKENS,
            totalDrawn: this.expectedTotalDrawnAfter1Day,
            lastDrawnAt: this._1DayAfterScheduleStart.toString(),
            drawDownRate: TEN_THOUSAND_TOKENS.div(totalDuration),
            remainingBalance: TEN_THOUSAND_TOKENS.sub(this.expectedTotalDrawnAfter1Day)
          });

          await validateAvailableDrawDownAmount(beneficiary1, {
            amount: '0', // no more left ot draw down
          });

          (await this.token.balanceOf(beneficiary1))
            .should.be.bignumber.equal(this.expectedTotalDrawnAfter1Day);

          (await this.token.balanceOf(this.vestingContract.address))
            .should.be.bignumber.equal(TEN_THOUSAND_TOKENS.sub(this.expectedTotalDrawnAfter1Day));

          const {_remainingBalance} = await this.vestingContract.vestingScheduleForBeneficiary(beneficiary1);
          _remainingBalance.should.be.bignumber.equal(TEN_THOUSAND_TOKENS.sub(this.expectedTotalDrawnAfter1Day));

          expectEvent(this.transaction, 'DrawDown', {
            _beneficiary: beneficiary1,
            _amount: this.expectedTotalDrawnAfter1Day,
            _time: this._1DayAfterScheduleStart.toString()
          });
        });

        describe('after 5 day - half tokens issues', async () => {
          beforeEach(async () => {
            this._5DaysAfterScheduleStart = this.now.add(PERIOD_ONE_DAY_IN_SECONDS.mul(new BN('5')));
            await this.vestingContract.fixTime(this._5DaysAfterScheduleStart, fromCudos);
            this.transaction = await this.vestingContract.drawDown({from: beneficiary1});
          });

          it('more tokens issued', async () => {
            const expectedTotalDrawnAfter5Day = this.expectedTotalDrawnAfter1Day.mul(new BN('5'));

            const start = new BN(this.now.toString());
            const totalDuration = new BN(`${_10days}`).mul(PERIOD_ONE_DAY_IN_SECONDS);
            const end = start.add(totalDuration);

            await validateVestingScheduleForBeneficiary(beneficiary1, {
              start,
              end,
              cliff: new BN('0'),
              amount: TEN_THOUSAND_TOKENS,
              totalDrawn: expectedTotalDrawnAfter5Day.toString(),
              lastDrawnAt: this._5DaysAfterScheduleStart.toString(),
              drawDownRate: TEN_THOUSAND_TOKENS.div(totalDuration),
              remainingBalance: TEN_THOUSAND_TOKENS.sub(expectedTotalDrawnAfter5Day)
            });

            await validateAvailableDrawDownAmount(beneficiary1, {
              amount: '0', // no more left ot draw down
            });

            (await this.token.balanceOf(beneficiary1))
              .should.be.bignumber.equal(expectedTotalDrawnAfter5Day);

            (await this.token.balanceOf(this.vestingContract.address))
              .should.be.bignumber.equal(TEN_THOUSAND_TOKENS.sub(expectedTotalDrawnAfter5Day));

            const {_remainingBalance} = await this.vestingContract.vestingScheduleForBeneficiary(beneficiary1);
            _remainingBalance.should.be.bignumber.equal(TEN_THOUSAND_TOKENS.sub(expectedTotalDrawnAfter5Day));

            expectEvent(this.transaction, 'DrawDown', {
              _beneficiary: beneficiary1,
              _amount: this.expectedTotalDrawnAfter1Day.mul(new BN('4')),
              _time: this._5DaysAfterScheduleStart.toString()
            });
          });

          describe('after 11 days - over schedule - all remaining tokens issues', async () => {
            beforeEach(async () => {
              this._11DaysAfterScheduleStart = this.now.add(PERIOD_ONE_DAY_IN_SECONDS.mul(new BN('11')));
              await this.vestingContract.fixTime(this._11DaysAfterScheduleStart, fromCudos);
              this.transaction = await this.vestingContract.drawDown({from: beneficiary1});
            });

            it('all tokens issued', async () => {
              const start = new BN(this.now.toString());
              const totalDuration = new BN(`${_10days}`).mul(PERIOD_ONE_DAY_IN_SECONDS);
              const end = start.add(totalDuration);
              await validateVestingScheduleForBeneficiary(beneficiary1, {
                start,
                end,
                amount: TEN_THOUSAND_TOKENS,
                totalDrawn: TEN_THOUSAND_TOKENS,
                lastDrawnAt: this._11DaysAfterScheduleStart.toString(),
                drawDownRate: TEN_THOUSAND_TOKENS.div(totalDuration),
                remainingBalance: '0'
              });

              await validateAvailableDrawDownAmount(beneficiary1, {
                amount: '0', // no more left ot draw down
              });

              (await this.token.balanceOf(beneficiary1))
                .should.be.bignumber.equal(TEN_THOUSAND_TOKENS);

              (await this.token.balanceOf(this.vestingContract.address))
                .should.be.bignumber.equal('0');

              const {_remainingBalance} = await this.vestingContract.vestingScheduleForBeneficiary(beneficiary1);
              _remainingBalance.should.be.bignumber.equal('0');

              expectEvent(this.transaction, 'DrawDown', {
                _beneficiary: beneficiary1,
                _amount: TEN_THOUSAND_TOKENS.sub(this.expectedTotalDrawnAfter1Day.mul(new BN('5'))),
                _time: this._11DaysAfterScheduleStart.toString()
              });
            });
          });
        });
      });
    });
  });

  describe('single schedule - future start date', async () => {
    beforeEach(async () => {
      this.now = await latest();
      this.onyDayFromNow = this.now.add(PERIOD_ONE_DAY_IN_SECONDS.mul(new BN('1')));
      await givenAVestingSchedule({
        start: this.onyDayFromNow,
        amount: FIVE_THOUSAND_TOKENS,
        duration: _7days,
        ...fromCudos
      });
    });

    it('lastDrawnAt()', async () => {
      const {_lastDrawnAt} = await this.vestingContract.vestingScheduleForBeneficiary(beneficiary1);
      _lastDrawnAt.should.be.bignumber.equal('0');
    });

    it('vestingScheduleForBeneficiary()', async () => {
      const start = new BN(this.onyDayFromNow.toString());
      const totalDuration = new BN(`${_7days}`).mul(PERIOD_ONE_DAY_IN_SECONDS);
      const end = start.add(totalDuration);
      await validateVestingScheduleForBeneficiary(beneficiary1, {
        start,
        end,
        amount: FIVE_THOUSAND_TOKENS,
        totalDrawn: '0',
        lastDrawnAt: '0',
        drawDownRate: FIVE_THOUSAND_TOKENS.div(totalDuration),
        remainingBalance: FIVE_THOUSAND_TOKENS
      });
    });

    it('remainingBalance()', async () => {
      const {_remainingBalance} = await this.vestingContract.vestingScheduleForBeneficiary(beneficiary1);
      _remainingBalance.should.be.bignumber.equal('5000000000000000000000');
    });

    it('validateAvailableDrawDownAmount() is zero as not started yet', async () => {
      const amount = await this.vestingContract.availableDrawDownAmount(beneficiary1);
      amount.should.be.bignumber.equal('0');
    });
  });

  describe('single schedule - starts now - full draw after end date', async () => {
    beforeEach(async () => {
      this.now = await latest();
      await this.vestingContract.fixTime(this.now, fromCudos);

      this.transaction = await givenAVestingSchedule({
        start: this.now,
        ...fromCudos
      });

      this._11DaysAfterScheduleStart = this.now.add(PERIOD_ONE_DAY_IN_SECONDS.mul(new BN('11')));
      await this.vestingContract.fixTime(this._11DaysAfterScheduleStart, fromCudos);
    });

    it('should draw down full amount in one call', async () => {
      (await this.vestingContract.tokenBalance()).should.be.bignumber.equal(TEN_THOUSAND_TOKENS);

      (await this.token.balanceOf(beneficiary1)).should.be.bignumber.equal('0');

      await this.vestingContract.drawDown({from: beneficiary1});

      (await this.token.balanceOf(beneficiary1)).should.be.bignumber.equal(TEN_THOUSAND_TOKENS);

      (await this.vestingContract.tokenBalance()).should.be.bignumber.equal('0');
    });
  });

  describe('single schedule - future start - completes on time - attempts to withdraw after completed', async () => {
    beforeEach(async () => {
      this.now = await latest();

      this.transaction = await givenAVestingSchedule({
        start: this.now,
        ...fromCudos,
        beneficiary: beneficiary1,
        amount: _3333_THOUSAND_TOKENS,
        duration: _100days
      });
      await this.vestingContract.fixTime(this.now, fromCudos);
    });

    describe('After all time has passed and all tokens claimed', async () => {
      beforeEach(async () => {
        this._100DaysAfterScheduleStart = this.now.add(PERIOD_ONE_DAY_IN_SECONDS.mul(new BN('100'))).add(new BN('1'));

        await this.vestingContract.fixTime(this._100DaysAfterScheduleStart, fromCudos);

        (await this.vestingContract.tokenBalance()).should.be.bignumber.equal(_3333_THOUSAND_TOKENS);

        (await this.token.balanceOf(beneficiary1)).should.be.bignumber.equal('0');

        await this.vestingContract.drawDown({from: beneficiary1});
      });

      it('mo more tokens left to claim', async () => {
        (await this.token.balanceOf(beneficiary1)).should.be.bignumber.equal(_3333_THOUSAND_TOKENS);

        (await this.vestingContract.tokenBalance()).should.be.bignumber.equal('0');
      });

      it('draw down rates show correct values', async () => {
        const totalDuration = new BN(`${_100days}`).mul(PERIOD_ONE_DAY_IN_SECONDS);

        await validateVestingScheduleForBeneficiary(beneficiary1, {
          start: this.now.toString(),
          end: this.now.add(PERIOD_ONE_DAY_IN_SECONDS.mul(new BN('100'))),
          amount: _3333_THOUSAND_TOKENS,
          totalDrawn: _3333_THOUSAND_TOKENS,
          lastDrawnAt: this._100DaysAfterScheduleStart.toString(),
          drawDownRate: _3333_THOUSAND_TOKENS.div(totalDuration),
          remainingBalance: '0'
        });

        await validateAvailableDrawDownAmount(beneficiary1, {
          amount: '0', // no more left ot draw down
        });
      });

      it('no further tokens can be drawn down', async () => {
        await expectRevert(
          this.vestingContract.drawDown({from: beneficiary1}),
          'Nothing to withdraw'
        );
      });
    });
  });

  describe('single schedule - with cliff', async () => {
    beforeEach(async () => {
      this.now = await latest();

      await this.vestingContract.fixTime(this.now, fromCudos);

      this.transaction = await givenAVestingSchedule({
        start: this.now,
        cliff: _7days, // 7 day cliff
        beneficiary: beneficiary1,
        amount: _3333_THOUSAND_TOKENS,
        duration: _100days,
        ...fromCudos,
      });
    });

    describe('Still in cliff period after 3 days', async () => {
      beforeEach(async () => {
        this._3DaysAfterScheduleStart = this.now.add(PERIOD_ONE_DAY_IN_SECONDS.mul(new BN('3')));

        await this.vestingContract.fixTime(this._3DaysAfterScheduleStart, fromCudos);

        (await this.vestingContract.tokenBalance()).should.be.bignumber.equal(_3333_THOUSAND_TOKENS);

        (await this.token.balanceOf(beneficiary1)).should.be.bignumber.equal('0');
      });

      it('no tokens to claim yet', async () => {
          await expectRevert(
            this.vestingContract.drawDown({from: beneficiary1}),
            'VestingContract.drawDown: Nothing to withdraw'
          );

        (await this.token.balanceOf(beneficiary1)).should.be.bignumber.equal('0');
      });
    });

    describe('Can withdraw after cliff period but before end', async () => {
      beforeEach(async () => {
        this._8DaysAfterScheduleStart = this.now.add(PERIOD_ONE_DAY_IN_SECONDS.mul(new BN('8')));

        await this.vestingContract.fixTime(this._8DaysAfterScheduleStart, fromCudos);

        (await this.vestingContract.tokenBalance()).should.be.bignumber.equal(_3333_THOUSAND_TOKENS);

        (await this.token.balanceOf(beneficiary1)).should.be.bignumber.equal('0');

        await this.vestingContract.drawDown({from: beneficiary1});
      });

      it('claim tokens due', async () => {
        // we have tokens
        (await this.token.balanceOf(beneficiary1)).should.be.bignumber.gt('0');
      });

      it('draw down rates show correct values', async () => {
        const totalDuration = new BN(`${_100days}`).mul(PERIOD_ONE_DAY_IN_SECONDS);

        await validateVestingScheduleForBeneficiary(beneficiary1, {
          start: this.now,
          end: this.now.add(PERIOD_ONE_DAY_IN_SECONDS.mul(new BN('100'))),
          cliff: this.now.add(PERIOD_ONE_DAY_IN_SECONDS.mul(new BN('7'))),
          amount: _3333_THOUSAND_TOKENS,
          totalDrawn: _3333_THOUSAND_TOKENS.div(totalDuration).mul(PERIOD_ONE_DAY_IN_SECONDS.mul(new BN('8'))), // 8 days worth
          lastDrawnAt: this._8DaysAfterScheduleStart,
          drawDownRate: _3333_THOUSAND_TOKENS.div(totalDuration),
          remainingBalance: _3333_THOUSAND_TOKENS.sub(_3333_THOUSAND_TOKENS.div(totalDuration).mul(PERIOD_ONE_DAY_IN_SECONDS.mul(new BN('8'))))
        });

        await validateAvailableDrawDownAmount(beneficiary1, {
          amount: '0', // no more left ot draw down
        });
      });

    });
  });

  describe('multiple schedules', async () => {
    beforeEach(async () => {
      this.now = await latest();
      await this.vestingContract.fixTime(this.now, fromCudos);

      await givenAVestingSchedule({
        start: this.now,
        beneficiary: beneficiary1,
        amount: _3333_THOUSAND_TOKENS,
        duration: _10days,
        ...fromCudos,
      });

      this._1DayInTheFuture = this.now.add(PERIOD_ONE_DAY_IN_SECONDS.mul(new BN('1')));
      await givenAVestingSchedule({
        start: this._1DayInTheFuture,
        ...fromCudos,
        beneficiary: beneficiary2,
        amount: TEN_THOUSAND_TOKENS,
        duration: _100days
      });

      this._3DayInTheFuture = this.now.add(PERIOD_ONE_DAY_IN_SECONDS.mul(new BN('3')));
      await givenAVestingSchedule({
        start: this._3DayInTheFuture,
        ...fromCudos,
        beneficiary: beneficiary3,
        amount: FIVE_THOUSAND_TOKENS,
        duration: _7days
      });

    });

    it('vesting contract holds all tokens for all schedules', async () => {
      const tokenBalance = await this.token.balanceOf(this.vestingContract.address);
      tokenBalance.should.be.bignumber.equal(
        _3333_THOUSAND_TOKENS.add(TEN_THOUSAND_TOKENS).add(FIVE_THOUSAND_TOKENS)
      );

      const vestingTokenBalance = await this.vestingContract.tokenBalance();
      vestingTokenBalance.should.be.bignumber.equal(
        _3333_THOUSAND_TOKENS.add(TEN_THOUSAND_TOKENS).add(FIVE_THOUSAND_TOKENS)
      );
    });

    it('schedule 1 setup correctly', async () => {
      const totalDuration = new BN(`${_10days}`).mul(PERIOD_ONE_DAY_IN_SECONDS);

      await validateVestingScheduleForBeneficiary(beneficiary1, {
        start: this.now.toString(),
        end: this.now.add(PERIOD_ONE_DAY_IN_SECONDS.mul(new BN('10'))),
        amount: _3333_THOUSAND_TOKENS,
        totalDrawn: '0',
        lastDrawnAt: '',
        drawDownRate: _3333_THOUSAND_TOKENS.div(totalDuration),
        remainingBalance: _3333_THOUSAND_TOKENS
      });

      await validateAvailableDrawDownAmount(beneficiary1, {
        amount: '0'
      });

      (await this.token.balanceOf(beneficiary1)).should.be.bignumber.equal('0');
    });

    it('schedule 2 setup correctly', async () => {
      const totalDuration = new BN(`${_100days}`).mul(PERIOD_ONE_DAY_IN_SECONDS);

      await validateVestingScheduleForBeneficiary(beneficiary2, {
        start: this._1DayInTheFuture.toString(),
        end: this._1DayInTheFuture.add(PERIOD_ONE_DAY_IN_SECONDS.mul(new BN('100'))),
        amount: TEN_THOUSAND_TOKENS,
        totalDrawn: '0',
        lastDrawnAt: '',
        drawDownRate: TEN_THOUSAND_TOKENS.div(totalDuration),
        remainingBalance: TEN_THOUSAND_TOKENS
      });

      // zero as not started yet

      const amount = await this.vestingContract.availableDrawDownAmount(beneficiary2);
      amount.should.be.bignumber.equal('0');
      (await this.token.balanceOf(beneficiary2)).should.be.bignumber.equal('0');
    });

    it('schedule 3 setup correctly', async () => {
      const totalDuration = new BN(`${_7days}`).mul(PERIOD_ONE_DAY_IN_SECONDS);

      await validateVestingScheduleForBeneficiary(beneficiary3, {
        start: this._3DayInTheFuture.toString(),
        end: this._3DayInTheFuture.add(PERIOD_ONE_DAY_IN_SECONDS.mul(new BN('7'))),
        amount: FIVE_THOUSAND_TOKENS,
        totalDrawn: '0',
        lastDrawnAt: '',
        drawDownRate: FIVE_THOUSAND_TOKENS.div(totalDuration),
        remainingBalance: FIVE_THOUSAND_TOKENS
      });

      // reverts as not started yet
      const amount = await this.vestingContract.availableDrawDownAmount(beneficiary3);
      amount.should.be.bignumber.equal('0');

      (await this.token.balanceOf(beneficiary3)).should.be.bignumber.equal('0');
    });

    describe('2 days in the future', async () => {
      beforeEach(async () => {
        this._2DaysInTheFuture = moment.unix(this.now).add(2, 'days').unix().valueOf();
        await this.vestingContract.fixTime(this._2DaysInTheFuture, fromCudos);
      });

      describe('schedule 1 & 2 can be drawn down', async () => {
        beforeEach(async () => {
          await this.vestingContract.drawDown({from: beneficiary1});
          await this.vestingContract.drawDown({from: beneficiary2});
        });

        it('beneficiary 1 has valid number of issued tokens', async () => {
          const totalDuration = new BN(`${_10days}`).mul(PERIOD_ONE_DAY_IN_SECONDS);
          const timePassed = new BN('2').mul(PERIOD_ONE_DAY_IN_SECONDS);
          const lastDrawnAt = this._2DaysInTheFuture.toString();
          const drawDownRate = _3333_THOUSAND_TOKENS.div(totalDuration);
          const totalDrawn = drawDownRate.mul(new BN(timePassed));

          // Check beneficiary schedule correct
          await validateVestingScheduleForBeneficiary(beneficiary1, {
            start: this.now.toString(),
            end: this.now.add(PERIOD_ONE_DAY_IN_SECONDS.mul(new BN('10'))),
            amount: _3333_THOUSAND_TOKENS,
            totalDrawn: totalDrawn,
            lastDrawnAt: lastDrawnAt,
            drawDownRate: drawDownRate,
            remainingBalance: _3333_THOUSAND_TOKENS.sub(
              totalDrawn
            )
          });

          // Check beneficiary balance correct
          (await this.token.balanceOf(beneficiary1)).should.be.bignumber.equal(totalDrawn);
        });

        it('beneficiary 2 has valid number of issued tokens', async () => {
          const totalDuration = new BN(`${_100days}`).mul(PERIOD_ONE_DAY_IN_SECONDS);
          const timePassed = new BN('1').mul(PERIOD_ONE_DAY_IN_SECONDS);
          const lastDrawnAt = this._2DaysInTheFuture.toString();
          const drawDownRate = TEN_THOUSAND_TOKENS.div(totalDuration);
          const totalDrawn = drawDownRate.mul(new BN(timePassed));

          // Check beneficiary schedule correct
          await validateVestingScheduleForBeneficiary(beneficiary2, {
            start: this._1DayInTheFuture.toString(),
            end: this._1DayInTheFuture.add(PERIOD_ONE_DAY_IN_SECONDS.mul(new BN('100'))),
            amount: TEN_THOUSAND_TOKENS,
            totalDrawn: totalDrawn,
            lastDrawnAt: lastDrawnAt,
            drawDownRate: drawDownRate,
            remainingBalance: TEN_THOUSAND_TOKENS.sub(
              totalDrawn
            )
          });

          // Check beneficiary balance correct
          (await this.token.balanceOf(beneficiary2)).should.be.bignumber.equal(totalDrawn);
        });

        it('vesting contract balances correctly marry up', async () => {
          const schedule1DrawDown = _3333_THOUSAND_TOKENS
            .div(
              new BN(`${_10days}`).mul(PERIOD_ONE_DAY_IN_SECONDS) // total duration
            ).mul(
              new BN('2').mul(PERIOD_ONE_DAY_IN_SECONDS) // time passed
            );

          const schedule2DrawDown = TEN_THOUSAND_TOKENS
            .div(
              new BN(`${_100days}`).mul(PERIOD_ONE_DAY_IN_SECONDS) // total duration
            ).mul(
              new BN('1').mul(PERIOD_ONE_DAY_IN_SECONDS) // time passed
            );

          const remainingBalance = _3333_THOUSAND_TOKENS
            .add(TEN_THOUSAND_TOKENS)
            .add(FIVE_THOUSAND_TOKENS)
            .sub(schedule1DrawDown)
            .sub(schedule2DrawDown);

          const vestingTokenBalance = await this.token.balanceOf(this.vestingContract.address);
          vestingTokenBalance.should.be.bignumber.equal(remainingBalance);

          const vestingContractBalance = await this.vestingContract.tokenBalance();
          vestingContractBalance.should.be.bignumber.equal(remainingBalance);
        });
      });

      describe('11 days in the future', async () => {
        beforeEach(async () => {
          this._11DaysInTheFuture = this.now.add(PERIOD_ONE_DAY_IN_SECONDS.mul(new BN('11')));
          await this.vestingContract.fixTime(this._11DaysInTheFuture, fromCudos);
        });

        beforeEach(async () => {
          await this.vestingContract.drawDown({from: beneficiary1});
          await this.vestingContract.drawDown({from: beneficiary2});
          await this.vestingContract.drawDown({from: beneficiary3});
        });

        it('beneficiary 1 drawn down complete', async () => {
          const totalDuration = new BN(`${_10days}`).mul(PERIOD_ONE_DAY_IN_SECONDS);

          // Check beneficiary schedule correct
          await validateVestingScheduleForBeneficiary(beneficiary1, {
            start: this.now.toString(),
            end: this.now.add(PERIOD_ONE_DAY_IN_SECONDS.mul(new BN('10'))),
            amount: _3333_THOUSAND_TOKENS,
            totalDrawn: _3333_THOUSAND_TOKENS,
            lastDrawnAt: this._11DaysInTheFuture.toString(),
            drawDownRate: _3333_THOUSAND_TOKENS.div(totalDuration),
            remainingBalance: '0'
          });

          // Check beneficiary balance correct
          (await this.token.balanceOf(beneficiary1)).should.be.bignumber.equal(_3333_THOUSAND_TOKENS);
        });

        it('beneficiary 2 in flight', async () => {
          const totalDuration = new BN(`${_100days}`).mul(PERIOD_ONE_DAY_IN_SECONDS);
          const timePassed = new BN('10').mul(PERIOD_ONE_DAY_IN_SECONDS);
          const drawDownRate = TEN_THOUSAND_TOKENS.div(totalDuration);
          const totalDrawn = drawDownRate.mul(new BN(timePassed));

          // Check beneficiary schedule correct
          await validateVestingScheduleForBeneficiary(beneficiary2, {
            start: this._1DayInTheFuture.toString(),
            end: this._1DayInTheFuture.add(totalDuration),
            amount: TEN_THOUSAND_TOKENS,
            totalDrawn: totalDrawn,
            lastDrawnAt: this._11DaysInTheFuture.toString(),
            drawDownRate: drawDownRate,
            remainingBalance: TEN_THOUSAND_TOKENS.sub(
              totalDrawn
            )
          });

          // Check beneficiary balance correct
          (await this.token.balanceOf(beneficiary2)).should.be.bignumber.equal(totalDrawn);
        });

        it('beneficiary 3 drawn down complete', async () => {
          const totalDuration = new BN(`${_7days}`).mul(PERIOD_ONE_DAY_IN_SECONDS);

          // Check beneficiary schedule correct
          await validateVestingScheduleForBeneficiary(beneficiary3, {
            start: this._3DayInTheFuture.toString(),
            end: this._3DayInTheFuture.add(totalDuration),
            amount: FIVE_THOUSAND_TOKENS,
            totalDrawn: FIVE_THOUSAND_TOKENS,
            lastDrawnAt: this._11DaysInTheFuture.toString(),
            drawDownRate: FIVE_THOUSAND_TOKENS.div(totalDuration),
            remainingBalance: '0'
          });

          // Check beneficiary balance correct
          (await this.token.balanceOf(beneficiary3)).should.be.bignumber.equal(FIVE_THOUSAND_TOKENS);
        });

        it('vesting contract balances correctly marry up', async () => {
          const schedule2DrawDown = TEN_THOUSAND_TOKENS.div(
            new BN(`${_100days}`).mul(PERIOD_ONE_DAY_IN_SECONDS) // total drawn down
          ).mul(
            new BN('10').mul(PERIOD_ONE_DAY_IN_SECONDS) // time passed
          );

          const remainingBalance = _3333_THOUSAND_TOKENS
            .add(TEN_THOUSAND_TOKENS)
            .add(FIVE_THOUSAND_TOKENS)
            .sub(_3333_THOUSAND_TOKENS) // schedule 1 complete
            .sub(FIVE_THOUSAND_TOKENS) // schedule 3 complete
            .sub(schedule2DrawDown); // schedule 2 in flight

          const vestingTokenBalance = await this.token.balanceOf(this.vestingContract.address);
          vestingTokenBalance.should.be.bignumber.equal(remainingBalance);

          const vestingContractBalance = await this.vestingContract.tokenBalance();
          vestingContractBalance.should.be.bignumber.equal(remainingBalance);
        });

        it('beneficiary 1 cannot drawn down anymore', async () => {
          await expectRevert(
            this.vestingContract.drawDown({from: beneficiary1}),
            'VestingContract.drawDown: Nothing to withdraw'
          );
          (await this.token.balanceOf(beneficiary1)).should.be.bignumber.equal(_3333_THOUSAND_TOKENS);
        });

        it('beneficiary 2 has remaining balance', async () => {
          const totalDuration = new BN(`${_100days}`).mul(PERIOD_ONE_DAY_IN_SECONDS);
          const timePassed = new BN('10').mul(PERIOD_ONE_DAY_IN_SECONDS);
          const drawDownRate = TEN_THOUSAND_TOKENS.div(totalDuration);
          const totalDrawn = drawDownRate.mul(new BN(timePassed));

          const {_remainingBalance} = await this.vestingContract.vestingScheduleForBeneficiary(beneficiary2);
          _remainingBalance.should.be.bignumber.eq(TEN_THOUSAND_TOKENS.sub(totalDrawn));

          await validateAvailableDrawDownAmount(beneficiary2, {
            amount: '0', // no more left to draw dome immediately
          });
        });

        it('beneficiary 3 cannot drawn down anymore', async () => {
          await expectRevert(
            this.vestingContract.drawDown({from: beneficiary3}),
            'VestingContract.drawDown: Nothing to withdraw'
          );
          (await this.token.balanceOf(beneficiary3)).should.be.bignumber.equal(FIVE_THOUSAND_TOKENS);
        });
      });
    });
  });

  describe('pausing', async () => {
    describe('when whitelisted', async () => {
      beforeEach(async () => {
        this.txReceipt = await this.vestingContract.pause(fromCudos);
      });

      it('should have paused', async () => {
        (await this.vestingContract.paused()).should.be.equal(true);
      });

      it('should have emitted a Paused event', async () => {
        await expectEvent(this.txReceipt, 'Paused',
          {
            account: cudos
          }
        );
      });

      it('reverts when a beneficiary tries to draw down', async () => {
        await givenAVestingSchedule(fromCudos);
        await expectRevert(
          this.vestingContract.drawDown({from: beneficiary1}),
          'Method cannot be invoked as contract has been paused'
        );
      });
    });

    describe('when not whitelisted', async () => {
      it('expect revert', async () => {
        (await this.vestingContract.paused()).should.be.equal(false);

        await expectRevert(
          this.vestingContract.pause({from: random}),
          'VestingContract.pause: Only admin'
        );

        (await this.vestingContract.paused()).should.be.equal(false);
      });
    });
  });

  describe('unpausing', async () => {
    describe('when whitelisted', async () => {
      beforeEach(async () => {
        await this.vestingContract.pause(fromCudos);
        (await this.vestingContract.paused()).should.be.equal(true);

        this.txReceipt = await this.vestingContract.unpause(fromCudos);
      });

      it('should have unpaused', async () => {
        (await this.vestingContract.paused()).should.be.equal(false);
      });

      it('should have emitted an Unpaused event', async () => {
        await expectEvent(this.txReceipt, 'Unpaused',
          {
            account: cudos
          }
        );
      });

      it('allows a beneficiary to draw down', async () => {
        await givenAVestingSchedule(
          {
            start: moment.unix(await latest()).subtract('1', 'day').unix().valueOf(),
            ...fromCudos
          }
        );
        await this.vestingContract.drawDown({from: beneficiary1});
      });
    });

    describe('when not whitelisted', async () => {
      it('expect revert when not paused', async () => {
        (await this.vestingContract.paused()).should.be.equal(false);

        await expectRevert(
          this.vestingContract.unpause({from: random}),
          'VestingContract.unpause: Only admin'
        );

        (await this.vestingContract.paused()).should.be.equal(false);
      });

      it('expect revert when paused', async () => {
        await this.vestingContract.pause(fromCudos);
        (await this.vestingContract.paused()).should.be.equal(true);

        await expectRevert(
          this.vestingContract.unpause({from: random}),
          'VestingContract.unpause: Only admin'
        );

        (await this.vestingContract.paused()).should.be.equal(true);
      });
    });
  });

  describe('VestingContract', async () => {
    beforeEach(async () => {
      this.vestingContract = await ActualVestingContract.new(this.token.address, this.accessControls.address, fromCudos);
    });

    it('returns zero for empty vesting schedule', async () => {
      const _amount = await this.vestingContract.availableDrawDownAmount(beneficiary1);
      _amount.should.be.bignumber.equal('0');
    });
  });

  const generateDefaultVestingSchedule = async () => {
    return {
      beneficiary: beneficiary1,
      amount: TEN_THOUSAND_TOKENS,
      start: (await latest()).add(PERIOD_ONE_DAY_IN_SECONDS.mul(new BN('1'))),
      duration: _10days,
      cliff: new BN('0'),
    };
  };

  const applyOptions = (options, object) => {
    if (!options) return object;
    Object.keys(options).forEach(key => {
      object[key] = options[key];
    });
    return object;
  };

  const givenAVestingSchedule = async (options) => {
    const defaultVestingSchedule = await generateDefaultVestingSchedule();
    const {beneficiary, amount, start, duration, cliff} = applyOptions(options, defaultVestingSchedule);
    const schedule = await this.vestingContract.createVestingSchedule(beneficiary, amount, start, duration, cliff, {from: options.from});
    return schedule;
  };

  const validateVestingScheduleForBeneficiary = async (beneficiary, expectations) => {
    const {_start, _end, _cliff, _amount, _totalDrawn, _lastDrawnAt, _drawDownRate, _remainingBalance} = await this.vestingContract.vestingScheduleForBeneficiary(beneficiary);

    _start.should.be.bignumber.equal(expectations.start, 'start incorrect');
    _end.should.be.bignumber.equal(expectations.end, 'end incorrect');
    // _cliff.should.be.bignumber.equal(expectations.cliff, 'cliff incorrect');
    _amount.should.be.bignumber.equal(expectations.amount, 'amount incorrect');
    _totalDrawn.should.be.bignumber.equal(expectations.totalDrawn, 'totalDrawn incorrect');
    _lastDrawnAt.should.be.bignumber.equal(expectations.lastDrawnAt, 'lastDrawnAt incorrect');
    _drawDownRate.should.be.bignumber.equal(expectations.drawDownRate, 'drawDownRate incorrect');
    _remainingBalance.should.be.bignumber.equal(expectations.remainingBalance, 'remainingBalance incorrect');
  };

  const validateAvailableDrawDownAmount = async (beneficiary, expectations) => {
    const _amount = await this.vestingContract.availableDrawDownAmount(beneficiary);
    _amount.should.be.bignumber.equal(expectations.amount);
  };
});
