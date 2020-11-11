// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../vesting/VestingContract.sol";

// @notice dev - overridden contract for specifying block.timestamp in tests
contract VestingContractWithFixedTime is VestingContract {

    uint256 time;

    constructor(IERC20 _token, CudosAccessControls _accessControls) VestingContract(_token, _accessControls) public {}

    function fixTime(uint256 _time) external {
        require(accessControls.hasAdminRole(_msgSender()), "VestingContract.createVestingSchedule: Only admin");
        time = _time;
    }

    function _getNow() internal view override returns (uint256) {
        if (time != 0) {
            return time;
        }
        return block.timestamp;
    }

}
