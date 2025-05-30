import { Construct, IConstruct, Node } from 'constructs';
import * as _ from 'lodash';
import * as codepipeline from '../../../aws-codepipeline';
import * as notifications from '../../../aws-codestarnotifications';
import * as events from '../../../aws-events';
import * as iam from '../../../aws-iam';
import * as s3 from '../../../aws-s3';
import * as cdk from '../../../core';
import * as cpactions from '../../lib';

describe('Pipeline Actions', () => {
  describe('CreateReplaceChangeSet', () => {
    test('works', (done) => {
      const app = new cdk.App();
      const stack = new cdk.Stack(app, 'Stack');
      const pipelineRole = new RoleDouble(stack, 'PipelineRole');
      const artifact = new codepipeline.Artifact('TestArtifact');
      const action = new cpactions.CloudFormationCreateReplaceChangeSetAction({
        actionName: 'Action',
        changeSetName: 'MyChangeSet',
        stackName: 'MyStack',
        templatePath: artifact.atPath('path/to/file'),
        adminPermissions: false,
      });
      const stage = new StageDouble({
        pipeline: new PipelineDouble(stack, 'Pipeline', { role: pipelineRole }),
        actions: [action],
      });

      app.synth();

      _assertPermissionGranted(done, stack, pipelineRole.statements, 'iam:PassRole', action.deploymentRole.roleArn);

      const stackArn = _stackArn('MyStack', stack);
      const changeSetCondition = { StringEqualsIfExists: { 'cloudformation:ChangeSetName': 'MyChangeSet' } };
      _assertPermissionGranted(done, stack, pipelineRole.statements, 'cloudformation:DescribeStacks', stackArn, changeSetCondition);
      _assertPermissionGranted(done, stack, pipelineRole.statements, 'cloudformation:DescribeChangeSet', stackArn, changeSetCondition);
      _assertPermissionGranted(done, stack, pipelineRole.statements, 'cloudformation:CreateChangeSet', stackArn, changeSetCondition);
      _assertPermissionGranted(done, stack, pipelineRole.statements, 'cloudformation:DeleteChangeSet', stackArn, changeSetCondition);

      // TODO: revert "as any" once we move all actions into a single package.
      expect(stage.fullActions[0].actionProperties.inputs).toEqual([artifact]);

      _assertActionMatches(done, stack, stage.fullActions, 'CloudFormation', 'Deploy', {
        ActionMode: 'CHANGE_SET_CREATE_REPLACE',
        StackName: 'MyStack',
        ChangeSetName: 'MyChangeSet',
      });

      done();
    });

    test('uses a single permission statement if the same ChangeSet name is used', () => {
      const stack = new cdk.Stack();
      const pipelineRole = new RoleDouble(stack, 'PipelineRole');
      const artifact = new codepipeline.Artifact('TestArtifact');
      new StageDouble({
        pipeline: new PipelineDouble(stack, 'Pipeline', { role: pipelineRole }),
        actions: [
          new cpactions.CloudFormationCreateReplaceChangeSetAction({
            actionName: 'ActionA',
            changeSetName: 'MyChangeSet',
            stackName: 'StackA',
            adminPermissions: false,
            templatePath: artifact.atPath('path/to/file'),
          }),
          new cpactions.CloudFormationCreateReplaceChangeSetAction({
            actionName: 'ActionB',
            changeSetName: 'MyChangeSet',
            stackName: 'StackB',
            adminPermissions: false,
            templatePath: artifact.atPath('path/to/other/file'),
          }),
        ],
      });

      expect(
        stack.resolve(pipelineRole.statements.map(s => s.toStatementJson())),
      ).toEqual(
        [
          {
            Action: 'iam:PassRole',
            Effect: 'Allow',
            Resource: [
              { 'Fn::GetAtt': ['PipelineTestStageActionARole9283FBE3', 'Arn'] },
              { 'Fn::GetAtt': ['PipelineTestStageActionBRoleCABC8FA5', 'Arn'] },
            ],
          },
          {
            Action: [
              'cloudformation:CreateChangeSet',
              'cloudformation:DeleteChangeSet',
              'cloudformation:DescribeChangeSet',
              'cloudformation:DescribeStacks',
            ],
            Condition: { StringEqualsIfExists: { 'cloudformation:ChangeSetName': 'MyChangeSet' } },
            Effect: 'Allow',
            Resource: [
              // eslint-disable-next-line max-len
              { 'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, ':cloudformation:', { Ref: 'AWS::Region' }, ':', { Ref: 'AWS::AccountId' }, ':stack/StackA/*']] },
              // eslint-disable-next-line max-len
              { 'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, ':cloudformation:', { Ref: 'AWS::Region' }, ':', { Ref: 'AWS::AccountId' }, ':stack/StackB/*']] },
            ],
          },
        ],
      );
    });
  });

  describe('ExecuteChangeSet', () => {
    test('works', (done) => {
      const stack = new cdk.Stack();
      const pipelineRole = new RoleDouble(stack, 'PipelineRole');
      const stage = new StageDouble({
        pipeline: new PipelineDouble(stack, 'Pipeline', { role: pipelineRole }),
        actions: [
          new cpactions.CloudFormationExecuteChangeSetAction({
            actionName: 'Action',
            changeSetName: 'MyChangeSet',
            stackName: 'MyStack',
          }),
        ],
      });

      const stackArn = _stackArn('MyStack', stack);
      _assertPermissionGranted(done, stack, pipelineRole.statements, 'cloudformation:ExecuteChangeSet', stackArn,
        { StringEqualsIfExists: { 'cloudformation:ChangeSetName': 'MyChangeSet' } });

      _assertActionMatches(done, stack, stage.fullActions, 'CloudFormation', 'Deploy', {
        ActionMode: 'CHANGE_SET_EXECUTE',
        StackName: 'MyStack',
        ChangeSetName: 'MyChangeSet',
      });

      done();
    });

    test('uses a single permission statement if the same ChangeSet name is used', () => {
      const stack = new cdk.Stack();
      const pipelineRole = new RoleDouble(stack, 'PipelineRole');
      new StageDouble({
        pipeline: new PipelineDouble(stack, 'Pipeline', { role: pipelineRole }),
        actions: [
          new cpactions.CloudFormationExecuteChangeSetAction({
            actionName: 'ActionA',
            changeSetName: 'MyChangeSet',
            stackName: 'StackA',
          }),
          new cpactions.CloudFormationExecuteChangeSetAction({
            actionName: 'ActionB',
            changeSetName: 'MyChangeSet',
            stackName: 'StackB',
          }),
        ],
      });

      expect(
        stack.resolve(pipelineRole.statements.map(s => s.toStatementJson())),
      ).toEqual(
        [
          {
            Action: [
              'cloudformation:DescribeChangeSet',
              'cloudformation:DescribeStackEvents',
              'cloudformation:DescribeStacks',
              'cloudformation:ExecuteChangeSet',
            ],
            Condition: { StringEqualsIfExists: { 'cloudformation:ChangeSetName': 'MyChangeSet' } },
            Effect: 'Allow',
            Resource: [
              // eslint-disable-next-line max-len
              { 'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, ':cloudformation:', { Ref: 'AWS::Region' }, ':', { Ref: 'AWS::AccountId' }, ':stack/StackA/*']] },
              // eslint-disable-next-line max-len
              { 'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, ':cloudformation:', { Ref: 'AWS::Region' }, ':', { Ref: 'AWS::AccountId' }, ':stack/StackB/*']] },
            ],
          },
        ],
      );
    });
  });

  test('the CreateUpdateStack Action sets the DescribeStack*, Create/Update/DeleteStack & PassRole permissions', (done) => {
    const stack = new cdk.Stack();
    const pipelineRole = new RoleDouble(stack, 'PipelineRole');
    const action = new cpactions.CloudFormationCreateUpdateStackAction({
      actionName: 'Action',
      templatePath: new codepipeline.Artifact('TestArtifact').atPath('some/file'),
      stackName: 'MyStack',
      adminPermissions: false,
      replaceOnFailure: true,
    });
    new StageDouble({
      pipeline: new PipelineDouble(stack, 'Pipeline', { role: pipelineRole }),
      actions: [action],
    });
    const stackArn = _stackArn('MyStack', stack);

    _assertPermissionGranted(done, stack, pipelineRole.statements, 'cloudformation:DescribeStack*', stackArn);
    _assertPermissionGranted(done, stack, pipelineRole.statements, 'cloudformation:CreateStack', stackArn);
    _assertPermissionGranted(done, stack, pipelineRole.statements, 'cloudformation:UpdateStack', stackArn);
    _assertPermissionGranted(done, stack, pipelineRole.statements, 'cloudformation:DeleteStack', stackArn);

    _assertPermissionGranted(done, stack, pipelineRole.statements, 'iam:PassRole', action.deploymentRole.roleArn);

    done();
  });

  test('the DeleteStack Action sets the DescribeStack*, DeleteStack & PassRole permissions', (done) => {
    const stack = new cdk.Stack();
    const pipelineRole = new RoleDouble(stack, 'PipelineRole');
    const action = new cpactions.CloudFormationDeleteStackAction({
      actionName: 'Action',
      adminPermissions: false,
      stackName: 'MyStack',
    });
    new StageDouble({
      pipeline: new PipelineDouble(stack, 'Pipeline', { role: pipelineRole }),
      actions: [action],
    });
    const stackArn = _stackArn('MyStack', stack);

    _assertPermissionGranted(done, stack, pipelineRole.statements, 'cloudformation:DescribeStack*', stackArn);
    _assertPermissionGranted(done, stack, pipelineRole.statements, 'cloudformation:DeleteStack', stackArn);

    _assertPermissionGranted(done, stack, pipelineRole.statements, 'iam:PassRole', action.deploymentRole.roleArn);

    done();
  });
});

interface PolicyStatementJson {
  Effect: 'Allow' | 'Deny';
  Action: string | string[];
  Resource: string | string[];
  Condition: any;
}

function _assertActionMatches(
  done: jest.DoneCallback,
  stack: cdk.Stack,
  actions: FullAction[],
  provider: string,
  category: string,
  configuration?: { [key: string]: any }) {
  const configurationStr = configuration
    ? `, configuration including ${JSON.stringify(stack.resolve(configuration), null, 2)}`
    : '';
  const actionsStr = JSON.stringify(actions.map(a =>
    ({
      owner: a.actionProperties.owner,
      provider: a.actionProperties.provider,
      category: a.actionProperties.category,
      configuration: stack.resolve(a.actionConfig.configuration),
    }),
  ), null, 2);
  if (!_hasAction(stack, actions, provider, category, configuration)) {
    done.fail(`Expected to find an action with provider ${provider}, category ${category}${configurationStr}, but found ${actionsStr}`);
  }
}

function _hasAction(
  stack: cdk.Stack, actions: FullAction[], provider: string, category: string,
  configuration?: { [key: string]: any}) {
  for (const action of actions) {
    if (action.actionProperties.provider !== provider) { continue; }
    if (action.actionProperties.category !== category) { continue; }
    if (configuration && !action.actionConfig.configuration) { continue; }
    if (configuration) {
      for (const key of Object.keys(configuration)) {
        if (!_.isEqual(stack.resolve(action.actionConfig.configuration[key]), stack.resolve(configuration[key]))) {
          continue;
        }
      }
    }
    return true;
  }
  return false;
}

function _assertPermissionGranted(
  done: jest.DoneCallback,
  stack: cdk.Stack,
  statements: iam.PolicyStatement[],
  action: string,
  resource: string,
  conditions?: any) {
  const conditionStr = conditions
    ? ` with condition(s) ${JSON.stringify(stack.resolve(conditions))}`
    : '';
  const resolvedStatements = stack.resolve(statements.map(s => s.toStatementJson()));
  const statementsStr = JSON.stringify(resolvedStatements, null, 2);
  if (!_grantsPermission(stack, resolvedStatements, action, resource, conditions)) {
    done.fail(`Expected to find a statement granting ${action} on ${JSON.stringify(stack.resolve(resource))}${conditionStr}, found:\n${statementsStr}`);
  }
}

function _grantsPermission(stack: cdk.Stack, statements: PolicyStatementJson[], action: string, resource: string, conditions?: any) {
  for (const statement of statements.filter(s => s.Effect === 'Allow')) {
    if (!_isOrContains(stack, statement.Action, action)) { continue; }
    if (!_isOrContains(stack, statement.Resource, resource)) { continue; }
    if (conditions && !_isOrContains(stack, statement.Condition, conditions)) { continue; }
    return true;
  }
  return false;
}

function _isOrContains(stack: cdk.Stack, entity: string | string[], value: string): boolean {
  const resolvedValue = stack.resolve(value);
  const resolvedEntity = stack.resolve(entity);
  if (_.isEqual(resolvedEntity, resolvedValue)) { return true; }
  if (!Array.isArray(resolvedEntity)) { return false; }
  for (const tested of entity) {
    if (_.isEqual(tested, resolvedValue)) { return true; }
  }
  return false;
}

function _stackArn(stackName: string, scope: IConstruct): string {
  return cdk.Stack.of(scope).formatArn({
    service: 'cloudformation',
    resource: 'stack',
    resourceName: `${stackName}/*`,
  });
}

class PipelineDouble extends cdk.Resource implements codepipeline.IPipeline {
  public readonly pipelineName: string;
  public readonly pipelineArn: string;
  public readonly role: iam.Role;
  public readonly artifactBucket: s3.IBucket;

  constructor(scope: Construct, id: string, { pipelineName, role }: { pipelineName?: string; role: iam.Role }) {
    super(scope, id);
    this.pipelineName = pipelineName || 'TestPipeline';
    this.pipelineArn = cdk.Stack.of(this).formatArn({ service: 'codepipeline', resource: 'pipeline', resourceName: this.pipelineName });
    this.role = role;
    this.artifactBucket = new BucketDouble(scope, 'BucketDouble');
  }

  public onEvent(_id: string, _options: events.OnEventOptions): events.Rule {
    throw new Error('Method not implemented.');
  }
  public onStateChange(_id: string, _options: events.OnEventOptions): events.Rule {
    throw new Error('Method not implemented.');
  }
  public notifyOn(
    _id: string,
    _target: notifications.INotificationRuleTarget,
    _options: codepipeline.PipelineNotifyOnOptions,
  ): notifications.NotificationRule {
    throw new Error('Method not implemented.');
  }
  public notifyOnExecutionStateChange(
    _id: string,
    _target: notifications.INotificationRuleTarget,
    _options?: notifications.NotificationRuleOptions,
  ): notifications.NotificationRule {
    throw new Error('Method not implemented.');
  }
  public notifyOnAnyStageStateChange(
    _id: string,
    _target: notifications.INotificationRuleTarget,
    _options?: notifications.NotificationRuleOptions,
  ): notifications.INotificationRule {
    throw new Error('Method not implemented.');
  }
  public notifyOnAnyActionStateChange(
    _id: string,
    _target: notifications.INotificationRuleTarget,
    _options?: notifications.NotificationRuleOptions,
  ): notifications.INotificationRule {
    throw new Error('Method not implemented.');
  }
  public notifyOnAnyManualApprovalStateChange(
    _id: string,
    _target: notifications.INotificationRuleTarget,
    _options?: notifications.NotificationRuleOptions,
  ): notifications.INotificationRule {
    throw new Error('Method not implemented.');
  }
  public bindAsNotificationRuleSource(
    _scope: Construct,
  ): notifications.NotificationRuleSourceConfig {
    throw new Error('Method not implemented.');
  }
}

class FullAction {
  constructor(
    readonly actionProperties: codepipeline.ActionProperties,
    readonly actionConfig: codepipeline.ActionConfig) {
    // empty
  }
}

class StageDouble implements codepipeline.IStage {
  public readonly stageName: string;
  public readonly pipeline: codepipeline.IPipeline;
  public readonly actions: codepipeline.IAction[] = [];
  public readonly fullActions: FullAction[];

  public get node(): Node {
    throw new Error('StageDouble is not a real construct');
  }

  constructor({ name, pipeline, actions }: { name?: string; pipeline: PipelineDouble; actions: codepipeline.IAction[] }) {
    this.stageName = name || 'TestStage';
    this.pipeline = pipeline;

    const stageParent = new Construct(pipeline, this.stageName);
    const fullActions = new Array<FullAction>();
    for (const action of actions) {
      const actionParent = new Construct(stageParent, action.actionProperties.actionName);
      fullActions.push(new FullAction(action.actionProperties, action.bind(actionParent, this, {
        role: pipeline.role,
        bucket: pipeline.artifactBucket,
      })));
    }
    this.fullActions = fullActions;
  }

  public addAction(_action: codepipeline.IAction): void {
    throw new Error('addAction() is not supported on StageDouble');
  }

  public onStateChange(_name: string, _target?: events.IRuleTarget, _options?: events.RuleProps):
  events.Rule {
    throw new Error('onStateChange() is not supported on StageDouble');
  }
}

class RoleDouble extends iam.Role {
  public readonly statements = new Array<iam.PolicyStatement>();

  constructor(scope: Construct, id: string, props: iam.RoleProps = { assumedBy: new iam.ServicePrincipal('test') }) {
    super(scope, id, props);
  }

  public addToPolicy(statement: iam.PolicyStatement): boolean {
    super.addToPolicy(statement);
    this.statements.push(statement);
    return true;
  }
}

class BucketDouble extends s3.Bucket {
  public grantRead(identity: iam.IGrantable, _objectsKeyPattern: any = '*'): iam.Grant {
    return iam.Grant.drop(identity, '');
  }

  public grantWrite(identity: iam.IGrantable, _objectsKeyPattern: any = '*'): iam.Grant {
    return iam.Grant.drop(identity, '');
  }

  public grantReadWrite(identity: iam.IGrantable, _objectsKeyPattern: any = '*'): iam.Grant {
    return iam.Grant.drop(identity, '');
  }
}
