exports.handler = function(event, context) {

	//Importing AWS SDK for nodejs
	var AWS = require('aws-sdk');
	var sns = new AWS.SNS();

	var Client = require('node-rest-client').Client;

	var q = require("q");

	var options_auth = { user: "basic_auth_user", password: "basic_auth_password" }
	var client = new Client(options_auth);

	process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

	var autoscaling = new AWS.AutoScaling();
	var ec2 = new AWS.EC2();

	var snsTopic = SNSTopicArn; //Put SNS topic ARN to trigger second lambda function

	var autoscalingGroup = ASG_NAME; //Auto-Scaling group where instances need to be scaled down

	var params = {
	  AutoScalingGroupNames: [
	    autoscalingGroup
	  ]
	};

	return q.ninvoke(autoscaling, 'describeAutoScalingGroups', params)
	.then(function(data){

		var instances =	data['AutoScalingGroups'][0].Instances;

		var zoneACount = 0;
		var zoneAInstance = [];
		var zoneAInstanceStatus = [];
		var zoneBCount = 0;
		var zoneBInstance = [];
		var zoneBInstanceStatus = [];
		var zoneCCount = 0;
		var zoneCInstance = [];
		var zoneCInstanceStatus = [];

		var minCount = data['AutoScalingGroups'][0].MinSize;
		var zones = data['AutoScalingGroups'][0].AvailabilityZones;

		instances.map(function(instance){
			
			if (instance.LifecycleState == "InService") {
				if (instance.AvailabilityZone == zones[0]) {				
					zoneAInstance.push(instance.InstanceId);
					zoneAInstanceStatus.push(instance.LifecycleState);
					zoneACount++;				
				}
				if (instance.AvailabilityZone == zones[1]) {
					
					zoneBInstance.push(instance.InstanceId);
					zoneBInstanceStatus.push(instance.LifecycleState);
					zoneBCount++;
				}
				if (instance.AvailabilityZone == zones[2]) {
					zoneCInstance.push(instance.InstanceId);
					zoneCInstanceStatus.push(instance.LifecycleState);
					zoneCCount++;
				}
			}
		});

		var result = {
			'minCount': minCount,
			'zoneAData' : {
				'zoneACount' : zoneACount,
				'zoneAInstance' : zoneAInstance,
				'zoneAInstanceStatus' : zoneAInstanceStatus,
				'zoneAInstanceLength' : zoneAInstance.length
			},
			'zoneBData' : {
				'zoneBCount' : zoneBCount,
				'zoneBInstance' : zoneBInstance,
				'zoneBInstanceStatus' : zoneBInstanceStatus,
				'zoneBInstanceLength' : zoneBInstance.length
			},
			'zoneCData' : {
				'zoneCCount' : zoneCCount,
				'zoneCInstance' : zoneCInstance,
				'zoneCInstanceStatus' : zoneCInstanceStatus,
				'zoneCInstanceLength' : zoneCInstance.length
			}
		}
		return result;
	})
	.then(function(result){
		
		var resultCount = result.zoneAData.zoneAInstanceLength + result.zoneBData.zoneBInstanceLength + result.zoneCData.zoneCInstanceLength;

		if (resultCount <= result.minCount) {
			console.log("nothing to do.")
			var instanceData = "";
			return instanceData;
		} else {
			var highestCount;
			var selectedInstance;

			var instanceStatusA = {};
			var instanceStatusB = {};
			var instanceStatusC = {};

			var inServiceA = 0;
			var inServiceB = 0;
			var inServiceC = 0;
			

			if ( resultCount > result.minCount) {

				if ( result.zoneAData.zoneACount < result.zoneBData.zoneBCount ) {
					highestCount = result.zoneBData.zoneBCount;
					if (highestCount < result.zoneCData.zoneCCount) {
							selectedInstance = result.zoneCData.zoneCInstance[0];
					} else {
							selectedInstance = result.zoneBData.zoneBInstance[0];					
					}
				} else {
					highestCount = result.zoneAData.zoneACount;
					if (highestCount < result.zoneCData.zoneCCount) {						
							selectedInstance = result.zoneCData.zoneCInstance[0];						
					} else {						
							selectedInstance = result.zoneAData.zoneAInstance[0];				
					}
				}

				console.log(selectedInstance);
				var instanceData = {
					'minCount': result.minCount,
					'desiredCount': resultCount,
					'selectedInstance': selectedInstance
				}
				return instanceData;
			}
			else {
				console.log(totalInService, " ", result.minCount);
				console.log("nothing to do.");
			}
		}
	})
	.then(function(instanceData){

		if (instanceData && instanceData.selectedInstance) {

			console.log("instance data: ", instanceData);

			var selectedInstance = instanceData.selectedInstance;
			var minCount = instanceData.minCount;
			var desiredCount = instanceData.desiredCount;

			var params = {
			  InstanceIds: [		    
			    selectedInstance
			  ]
			};

			return q.ninvoke(ec2, 'describeInstances', params)
			.then(function(data){
				console.log(data['Reservations'][0]['Instances'][0]['PrivateIpAddress']);

				var privateIpAddress = data['Reservations'][0]['Instances'][0]['PrivateIpAddress'];
			 
				return suspendInstance(client, privateIpAddress, instanceData)

			})
			.then(callSuspendStatus)
			.done();
		} else {
			console.log("No action needed.")
			context.done(null, 'Instance suspend initiated, proceed to suspend and terminate.');  // SUCCESS with message
		}
	})
	.done();

	function suspendInstance(client, privateIpAddress, instanceData){

		var selectedInstance = instanceData.selectedInstance;
		var deferred = q.defer();
		var post_args = {
			headers: {"some_key": "my_key",
						"Content-Type": "application/json" },
			data: { "suspend_key" : "my_another_key",
					"hostname": privateIpAddress }				 
		}; // API call arguments to suspend all necessary processing

		console.log(post_args);

		//Enter your API endpoint here. Make sure your response is in JSON.
		client.post("https://myapp.com/suspend", post_args, function(data,response) {
			var status = data.toString(); 
			status = status.replace(/\\/g , "");
			status = status.replace(/^"(.*)"$/, '$1');
			statusData = JSON.parse(status);

			console.log(statusData);

			var suspendData = { 'privateIpAddress': privateIpAddress, 'selectedInstance': selectedInstance, 'statusData': statusData, 'minCount': instanceData.minCount, 'desiredCount': instanceData.desiredCount };
			deferred.resolve(suspendData);
		}).on('error',function(err){
			deferred.reject(err);
	        console.log('Something went wrong on the request', err.request.options);
		});
	    return deferred.promise;
	}

	function callSuspendStatus(suspendData){

		var message = JSON.stringify({ default: JSON.stringify({ instanceId: suspendData.selectedInstance, hostIP: suspendData.privateIpAddress, minCount: suspendData.minCount, desiredCount: suspendData.desiredCount }) });

		var snsParams = {
			Message: message, 
			MessageStructure: 'json',
			TopicArn: snsTopic
	    };

	    console.log(message);

	    return q.ninvoke(sns, 'publish', snsParams)
	    .then(function(data){
	        console.log("Here is data: ", data);	       
	        return data;
	    })
	    .then(function(){
	        context.done();
	    })
	    .catch(function(error){
	        console.log(error);
	    })
	    .done();

	}

};
