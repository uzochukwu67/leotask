// The 'test_recurring_task' test program.
import recurring_task.aleo;
program test_recurring_task.aleo {
    @test
    script test_it() {
        let result: u32 = recurring_task.aleo/main(1u32, 2u32);
        assert_eq(result, 3u32);
    }

    @test
    @should_fail
    transition do_nothing() {
        let result: u32 = recurring_task.aleo/main(2u32, 3u32);
        assert_eq(result, 3u32);
    }

    @noupgrade
    async constructor() {}
}
