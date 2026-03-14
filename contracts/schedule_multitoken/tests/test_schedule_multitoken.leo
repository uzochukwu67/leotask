// The 'test_schedule_multitoken' test program.
import schedule_multitoken.aleo;
program test_schedule_multitoken.aleo {
    @test
    script test_it() {
        let result: u32 = schedule_multitoken.aleo/main(1u32, 2u32);
        assert_eq(result, 3u32);
    }

    @test
    @should_fail
    transition do_nothing() {
        let result: u32 = schedule_multitoken.aleo/main(2u32, 3u32);
        assert_eq(result, 3u32);
    }

    @noupgrade
    async constructor() {}
}
